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

type CallState = {
  phase: CallPhase;
  kind: CallKind;
  call: CallRow | null;
  peerName: string;
  micOn: boolean;
  camOn: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
};

type CallsValue = CallState & {
  startCall: (args: { chatId: string; peerId: string; peerName: string; kind: CallKind }) => void;
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
  micOn: true,
  camOn: true,
  localStream: null,
  remoteStream: null,
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

  const acceptCall = useCallback(() => {
    const call = state.call;
    if (!call) return;
    void (async () => {
      try {
        stopRingtone();
        setState((s) => ({ ...s, phase: "connecting" }));
        const stream = await getMedia(call.kind);
        createPeer(stream);
        const channel = openChannel(call.id, "callee");
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") send("ready", {});
        });
        await supabase
          .from("calls")
          .update({ status: "accepted", started_at: new Date().toISOString() })
          .eq("id", call.id);
      } catch {
        toast.error("Não foi possível atender. Libere o microfone/câmera.");
        cleanup();
      }
    })();
  }, [cleanup, createPeer, getMedia, openChannel, send, state.call, stopRingtone]);

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
    send("hangup", {});
    cleanup();
    if (call) {
      void supabase
        .from("calls")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", call.id);
    }
  }, [cleanup, send, state.call]);

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
            .from("profiles")
            .select("display_name")
            .eq("id", call.caller_id)
            .maybeSingle()
            .then(({ data }) => {
              if (data?.display_name) {
                setState((s) => (s.call?.id === call.id ? { ...s, peerName: data.display_name } : s));
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
            if (call.status === "declined") {
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
      acceptCall,
      declineCall,
      hangUp,
      toggleMic,
      toggleCam,
    }),
    [acceptCall, declineCall, hangUp, startCall, state, toggleCam, toggleMic],
  );

  return <CallsContext.Provider value={value}>{children}</CallsContext.Provider>;
}

export function useCalls() {
  const ctx = useContext(CallsContext);
  if (!ctx) throw new Error("useCalls precisa estar dentro de CallsProvider");
  return ctx;
}
