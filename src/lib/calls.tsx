import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type CallKind = "voice" | "video";

type CallRow = {
  id: string;
  chat_id: string;
  caller_id: string;
  callee_id: string;
  kind: CallKind;
  status: string;
};

export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active";

export type RemotePeer = { id: string; stream: MediaStream; name: string };

type CallState = {
  phase: CallPhase;
  kind: CallKind;
  call: CallRow | null;
  peerName: string;
  isGroup: boolean;
  groupChatId: string | null;
  micOn: boolean;
  camOn: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remotePeers: RemotePeer[];
};

type CallsValue = CallState & {
  startCall: (args: { chatId: string; peerId: string; peerName: string; kind: CallKind }) => void;
  startGroupCall: (args: {
    chatId: string;
    memberIds: string[];
    chatName: string;
    kind: CallKind;
  }) => void;
  acceptCall: () => void;
  declineCall: () => void;
  hangUp: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
};

const CallsContext = createContext<CallsValue | null>(null);

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
};

const initialState: CallState = {
  phase: "idle",
  kind: "voice",
  call: null,
  peerName: "",
  isGroup: false,
  groupChatId: null,
  micOn: true,
  camOn: true,
  localStream: null,
  remoteStream: null,
  remotePeers: [],
};

export function CallsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const myId = user?.id ?? "";
  const [state, setState] = useState<CallState>(initialState);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const ringtoneRef = useRef<{ ctx: AudioContext; stop: () => void } | null>(null);
  // malha de chamadas em grupo
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const meshIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const namesRef = useRef<Map<string, string>>(new Map());

  const stopRingtone = useCallback(() => {
    ringtoneRef.current?.stop();
    ringtoneRef.current = null;
  }, []);

  const playRingtone = useCallback(() => {
    if (ringtoneRef.current) return;
    try {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 480;
      osc.connect(gain);
      osc.start();
      const timer = window.setInterval(() => {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.9);
      }, 1600);
      ringtoneRef.current = {
        ctx,
        stop: () => {
          window.clearInterval(timer);
          try {
            osc.stop();
          } catch {
            /* noop */
          }
          void ctx.close();
        },
      };
    } catch {
      /* áudio bloqueado pelo navegador */
    }
  }, []);

  const cleanup = useCallback(() => {
    stopRingtone();
    pcRef.current?.getSenders().forEach((s) => {
      try {
        s.track?.stop();
      } catch {
        /* noop */
      }
    });
    pcRef.current?.close();
    pcRef.current = null;
    peersRef.current.forEach((pc) => {
      try {
        pc.close();
      } catch {
        /* noop */
      }
    });
    peersRef.current.clear();
    meshIce.current.clear();
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    pendingIce.current = [];
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setState(initialState);
  }, [stopRingtone]);

  const getMedia = useCallback(async (kind: CallKind) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === "video" ? { facingMode: "user" } : false,
    });
    localRef.current = stream;
    setState((s) => ({ ...s, localStream: stream, micOn: true, camOn: kind === "video" }));
    return stream;
  }, []);

  const send = useCallback((event: string, payload: unknown) => {
    void channelRef.current?.send({ type: "broadcast", event, payload });
  }, []);

  const createPeer = useCallback(
    (stream: MediaStream) => {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const remote = new MediaStream();
      setState((s) => ({ ...s, remoteStream: remote }));
      pc.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((t) => {
          if (!remote.getTracks().includes(t)) remote.addTrack(t);
        });
        setState((s) => ({ ...s, remoteStream: remote, phase: "active" }));
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) send("ice", { candidate: event.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          stopRingtone();
          setState((s) => ({ ...s, phase: "active" }));
        }
        if (pc.connectionState === "failed") {
          toast.error("A conexão da chamada caiu.");
          cleanup();
        }
      };
      pcRef.current = pc;
      return pc;
    },
    [cleanup, send, stopRingtone],
  );

  const drainIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    for (const candidate of pendingIce.current) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* noop */
      }
    }
    pendingIce.current = [];
  }, []);

  const openChannel = useCallback(
    (callId: string, role: "caller" | "callee") => {
      const channel = supabase.channel(`call-${callId}`, { config: { broadcast: { self: false } } });
      channelRef.current = channel;

      channel.on("broadcast", { event: "ready" }, () => {
        if (role !== "caller") return;
        void (async () => {
          const pc = pcRef.current;
          if (!pc) return;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send("offer", { sdp: pc.localDescription });
        })();
      });

      channel.on("broadcast", { event: "offer" }, ({ payload }) => {
        void (async () => {
          const pc = pcRef.current;
          if (!pc || role !== "callee") return;
          await pc.setRemoteDescription(new RTCSessionDescription((payload as any).sdp));
          await drainIce();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send("answer", { sdp: pc.localDescription });
        })();
      });

      channel.on("broadcast", { event: "answer" }, ({ payload }) => {
        void (async () => {
          const pc = pcRef.current;
          if (!pc || role !== "caller") return;
          await pc.setRemoteDescription(new RTCSessionDescription((payload as any).sdp));
          await drainIce();
        })();
      });

      channel.on("broadcast", { event: "ice" }, ({ payload }) => {
        const candidate = (payload as any).candidate as RTCIceCandidateInit;
        const pc = pcRef.current;
        if (pc?.remoteDescription?.type) {
          void pc.addIceCandidate(candidate).catch(() => undefined);
        } else {
          pendingIce.current.push(candidate);
        }
      });

      channel.on("broadcast", { event: "hangup" }, () => {
        toast.info("Chamada encerrada.");
        cleanup();
      });

      return channel;
    },
    [cleanup, drainIce, send],
  );

  /* ---------------- chamadas em grupo (malha) ---------------- */

  const dropPeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {
        /* noop */
      }
      peersRef.current.delete(peerId);
    }
    meshIce.current.delete(peerId);
    setState((s) => ({ ...s, remotePeers: s.remotePeers.filter((p) => p.id !== peerId) }));
  }, []);

  const loadPeerName = useCallback((peerId: string) => {
    if (namesRef.current.has(peerId)) return;
    namesRef.current.set(peerId, "Participante");
    void supabase
      .from("profiles")
      .select("display_name")
      .eq("id", peerId)
      .maybeSingle()
      .then(({ data }) => {
        const name = data?.display_name;
        if (!name) return;
        namesRef.current.set(peerId, name);
        setState((s) => ({
          ...s,
          remotePeers: s.remotePeers.map((p) => (p.id === peerId ? { ...p, name } : p)),
        }));
      });
  }, []);

  const ensureMeshPeer = useCallback(
    (peerId: string) => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;
      const pc = new RTCPeerConnection(RTC_CONFIG);
      peersRef.current.set(peerId, pc);
      localRef.current?.getTracks().forEach((track) => pc.addTrack(track, localRef.current!));
      const remote = new MediaStream();
      loadPeerName(peerId);
      setState((s) => ({
        ...s,
        remotePeers: s.remotePeers.some((p) => p.id === peerId)
          ? s.remotePeers
          : [...s.remotePeers, { id: peerId, stream: remote, name: namesRef.current.get(peerId) ?? "Participante" }],
      }));
      pc.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((t) => {
          if (!remote.getTracks().includes(t)) remote.addTrack(t);
        });
        setState((s) => ({ ...s, phase: "active" }));
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send("mesh-ice", { from: myId, to: peerId, candidate: event.candidate.toJSON() });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          stopRingtone();
          setState((s) => ({ ...s, phase: "active" }));
        }
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          dropPeer(peerId);
        }
      };
      return pc;
    },
    [dropPeer, loadPeerName, myId, send, stopRingtone],
  );

  const offerTo = useCallback(
    (peerId: string) => {
      void (async () => {
        const pc = ensureMeshPeer(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send("mesh-sdp", { from: myId, to: peerId, sdp: pc.localDescription });
      })();
    },
    [ensureMeshPeer, myId, send],
  );

  const openMesh = useCallback(
    (chatId: string) => {
      const channel = supabase.channel(`mesh-${chatId}`, {
        config: { broadcast: { self: false } },
      });
      channelRef.current = channel;

      channel.on("broadcast", { event: "mesh-join" }, ({ payload }) => {
        const from = (payload as any).from as string;
        if (!from || from === myId) return;
        send("mesh-here", { from: myId, to: from });
        if (myId > from) offerTo(from);
      });

      channel.on("broadcast", { event: "mesh-here" }, ({ payload }) => {
        const { from, to } = payload as any;
        if (to !== myId || !from) return;
        if (myId > from) offerTo(from);
        else ensureMeshPeer(from);
      });

      channel.on("broadcast", { event: "mesh-sdp" }, ({ payload }) => {
        const { from, to, sdp } = payload as any;
        if (to !== myId || !from || !sdp) return;
        void (async () => {
          const pc = ensureMeshPeer(from);
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          const queued = meshIce.current.get(from) ?? [];
          for (const c of queued) {
            try {
              await pc.addIceCandidate(c);
            } catch {
              /* noop */
            }
          }
          meshIce.current.set(from, []);
          if (sdp.type === "offer") {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send("mesh-sdp", { from: myId, to: from, sdp: pc.localDescription });
          }
        })();
      });

      channel.on("broadcast", { event: "mesh-ice" }, ({ payload }) => {
        const { from, to, candidate } = payload as any;
        if (to !== myId || !from || !candidate) return;
        const pc = peersRef.current.get(from);
        if (pc?.remoteDescription?.type) {
          void pc.addIceCandidate(candidate).catch(() => undefined);
        } else {
          const list = meshIce.current.get(from) ?? [];
          list.push(candidate);
          meshIce.current.set(from, list);
        }
      });

      channel.on("broadcast", { event: "mesh-bye" }, ({ payload }) => {
        const from = (payload as any).from as string;
        if (from) dropPeer(from);
      });

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") send("mesh-join", { from: myId });
      });

      return channel;
    },
    [dropPeer, ensureMeshPeer, myId, offerTo, send],
  );

  const startCall = useCallback(
    ({
      chatId,
      peerId,
      peerName,
      kind,
    }: {
      chatId: string;
      peerId: string;
      peerName: string;
      kind: CallKind;
    }) => {
      if (state.phase !== "idle") {
        toast.info("Você já está em uma chamada.");
        return;
      }
      void (async () => {
        try {
          setState((s) => ({ ...s, phase: "outgoing", kind, peerName }));
          const stream = await getMedia(kind);
          const { data, error } = await supabase
            .from("calls")
            .insert({ chat_id: chatId, caller_id: myId, callee_id: peerId, kind })
            .select("id, chat_id, caller_id, callee_id, kind, status")
            .single();
          if (error || !data) throw error ?? new Error("sem chamada");
          const call = data as CallRow;
          setState((s) => ({ ...s, call, phase: "outgoing", kind, peerName }));
          createPeer(stream);
          openChannel(call.id, "caller").subscribe();
          playRingtone();
        } catch {
          toast.error("Não foi possível iniciar a chamada. Libere o microfone/câmera.");
          cleanup();
        }
      })();
    },
    [cleanup, createPeer, getMedia, myId, openChannel, playRingtone, state.phase],
  );

  const startGroupCall = useCallback(
    ({
      chatId,
      memberIds,
      chatName,
      kind,
    }: {
      chatId: string;
      memberIds: string[];
      chatName: string;
      kind: CallKind;
    }) => {
      if (state.phase !== "idle") {
        toast.info("Você já está em uma chamada.");
        return;
      }
      const others = memberIds.filter((id) => id && id !== myId);
      if (others.length === 0) {
        toast.info("Este grupo ainda não tem outros participantes.");
        return;
      }
      void (async () => {
        try {
          setState((s) => ({
            ...s,
            phase: "connecting",
            kind,
            peerName: chatName,
            isGroup: true,
            groupChatId: chatId,
          }));
          await getMedia(kind);
          const { error } = await supabase.from("calls").insert(
            others.map((callee) => ({
              chat_id: chatId,
              caller_id: myId,
              callee_id: callee,
              kind,
            })),
          );
          if (error) throw new Error(error.message);
          openMesh(chatId);
          playRingtone();
        } catch {
          toast.error("Não foi possível iniciar a chamada do grupo.");
          cleanup();
        }
      })();
    },
    [cleanup, getMedia, myId, openMesh, playRingtone, state.phase],
  );

  const acceptCall = useCallback(() => {
    const call = state.call;
    if (!call) return;
    const group = state.isGroup;
    void (async () => {
      try {
        stopRingtone();
        setState((s) => ({ ...s, phase: "connecting" }));
        const stream = await getMedia(call.kind);
        if (group) {
          openMesh(call.chat_id);
        } else {
          createPeer(stream);
          const channel = openChannel(call.id, "callee");
          channel.subscribe((status) => {
            if (status === "SUBSCRIBED") send("ready", {});
          });
        }
        await supabase
          .from("calls")
          .update({ status: "accepted", started_at: new Date().toISOString() })
          .eq("id", call.id);
      } catch {
        toast.error("Não foi possível atender. Libere o microfone/câmera.");
        cleanup();
      }
    })();
  }, [
    cleanup,
    createPeer,
    getMedia,
    openChannel,
    openMesh,
    send,
    state.call,
    state.isGroup,
    stopRingtone,
  ]);

  const declineCall = useCallback(() => {
    const call = state.call;
    cleanup();
    if (call) {
      void supabase
        .from("calls")
        .update({ status: "declined", ended_at: new Date().toISOString() })
        .eq("id", call.id);
    }
  }, [cleanup, state.call]);

  const hangUp = useCallback(() => {
    const call = state.call;
    if (state.isGroup) send("mesh-bye", { from: myId });
    else send("hangup", {});
    cleanup();
    if (call) {
      void supabase
        .from("calls")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", call.id);
    }
  }, [cleanup, myId, send, state.call, state.isGroup]);

  const toggleMic = useCallback(() => {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setState((s) => ({ ...s, micOn: track.enabled }));
  }, []);

  const toggleCam = useCallback(() => {
    const track = localRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setState((s) => ({ ...s, camOn: track.enabled }));
  }, []);

  // Chamadas recebidas
  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      .channel(`incoming-calls-${myId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "calls",
          filter: `callee_id=eq.${myId}`,
        },
        (payload) => {
          const call = payload.new as CallRow;
          if (call.status !== "ringing") return;
          setState((s) => {
            if (s.phase !== "idle") return s;
            return { ...initialState, phase: "incoming", kind: call.kind, call };
          });
          void supabase
            .from("chats")
            .select("is_group, name")
            .eq("id", call.chat_id)
            .maybeSingle()
            .then(({ data }) => {
              if (!data?.is_group) return;
              setState((s) =>
                s.call?.id === call.id
                  ? {
                      ...s,
                      isGroup: true,
                      groupChatId: call.chat_id,
                      peerName: data.name ?? "Grupo",
                    }
                  : s,
              );
            });
          void supabase
            .from("profiles")
            .select("display_name")
            .eq("id", call.caller_id)
            .maybeSingle()
            .then(({ data }) => {
              if (data?.display_name) {
                setState((s) =>
                  s.call?.id === call.id && !s.isGroup ? { ...s, peerName: data.display_name } : s,
                );
              }
            });
          playRingtone();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "calls" },
        (payload) => {
          const call = payload.new as CallRow;
          setState((s) => {
            if (s.call?.id !== call.id) return s;
            if (call.status === "declined" && !s.isGroup) {
              toast.info("Chamada recusada.");
              setTimeout(cleanup, 0);
            }
            if (call.status === "ended" && s.phase !== "active") {
              setTimeout(cleanup, 0);
            }
            return s;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [cleanup, myId, playRingtone]);

  useEffect(() => () => cleanup(), [cleanup]);

  const value = useMemo<CallsValue>(
    () => ({
      ...state,
      startCall,
      startGroupCall,
      acceptCall,
      declineCall,
      hangUp,
      toggleMic,
      toggleCam,
    }),
    [
      acceptCall,
      declineCall,
      hangUp,
      startCall,
      startGroupCall,
      state,
      toggleCam,
      toggleMic,
    ],
  );

  return <CallsContext.Provider value={value}>{children}</CallsContext.Provider>;
}

export function useCalls() {
  const ctx = useContext(CallsContext);
  if (!ctx) throw new Error("useCalls precisa estar dentro de CallsProvider");
  return ctx;
}
