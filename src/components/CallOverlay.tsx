import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useCalls } from "@/lib/calls";

function initials(name: string) {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function PeerTile({
  stream,
  name,
  video,
}: {
  stream: MediaStream;
  name: string;
  video: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="relative overflow-hidden rounded-xl bg-black/50">
      <video
        ref={ref}
        autoPlay
        playsInline
        className={video ? "h-full w-full object-cover" : "hidden"}
      />
      {!video && (
        <div className="flex h-full min-h-28 items-center justify-center">
          <Avatar className="h-16 w-16 text-xl">
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
        </div>
      )}
      <p className="absolute bottom-1 left-2 text-xs font-medium drop-shadow">{name}</p>
    </div>
  );
}

export function CallOverlay() {
  const {
    phase,
    kind,
    peerName,
    isGroup,
    remotePeers,
    micOn,
    camOn,
    localStream,
    remoteStream,
    acceptCall,
    declineCall,
    hangUp,
    toggleMic,
    toggleCam,
  } = useCalls();


  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (localVideo.current && localStream) localVideo.current.srcObject = localStream;
  }, [localStream, phase]);

  useEffect(() => {
    if (remoteVideo.current && remoteStream) remoteVideo.current.srcObject = remoteStream;
    if (remoteAudio.current && remoteStream) remoteAudio.current.srcObject = remoteStream;
  }, [remoteStream, phase]);

  useEffect(() => {
    if (phase !== "active") {
      setSeconds(0);
      return;
    }
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  if (phase === "idle") return null;

  const status =
    phase === "incoming"
      ? kind === "video"
        ? "Chamada de vídeo recebida"
        : "Chamada de voz recebida"
      : phase === "outgoing"
        ? "Chamando…"
        : phase === "connecting"
          ? "Conectando…"
          : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  const showVideo = kind === "video" && (phase === "active" || phase === "connecting");
  const showMesh = isGroup && (phase === "active" || phase === "connecting");

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-header/95 px-6 py-10 text-header-foreground backdrop-blur">
      {!isGroup && <audio ref={remoteAudio} autoPlay playsInline className="hidden" />}

      {showMesh ? (
        <div className="flex w-full max-w-3xl flex-1 flex-col gap-3">
          <p className="text-center text-sm font-medium">
            {peerName || "Grupo"} · {status} · {remotePeers.length + 1} na chamada
          </p>
          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
            {kind === "video" && (
              <div className="relative overflow-hidden rounded-xl bg-black/50">
                <video
                  ref={localVideo}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
                <p className="absolute bottom-1 left-2 text-xs font-medium drop-shadow">Você</p>
              </div>
            )}
            {remotePeers.map((peer) => (
              <PeerTile
                key={peer.id}
                stream={peer.stream}
                name={peer.name}
                video={kind === "video"}
              />
            ))}
          </div>
          {remotePeers.length === 0 && (
            <p className="text-center text-sm opacity-80">Esperando o grupo entrar…</p>
          )}
        </div>
      ) : showVideo ? (
        <div className="relative flex-1 w-full max-w-3xl overflow-hidden rounded-2xl bg-black/60">
          <video
            ref={remoteVideo}
            autoPlay
            playsInline
            className="h-full w-full object-cover"
          />
          <video
            ref={localVideo}
            autoPlay
            playsInline
            muted
            className="absolute bottom-3 right-3 h-32 w-24 rounded-xl border border-white/20 object-cover"
          />
          <p className="absolute left-4 top-3 text-sm font-medium drop-shadow">
            {peerName || "Contato"} · {status}
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <Avatar className="h-28 w-28 text-3xl">
            <AvatarFallback>{initials(peerName)}</AvatarFallback>
          </Avatar>
          <p className="text-2xl font-semibold">{peerName || "Contato"}</p>
          <p className="text-sm opacity-80">{isGroup ? `Chamada do grupo · ${status}` : status}</p>
        </div>
      )}


      <div className="flex items-center gap-4">
        {phase === "incoming" ? (
          <>
            <Button
              size="icon"
              aria-label="Recusar"
              onClick={declineCall}
              className="h-16 w-16 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
            <Button
              size="icon"
              aria-label="Atender"
              onClick={acceptCall}
              className="h-16 w-16 rounded-full"
            >
              <Phone className="h-6 w-6" />
            </Button>
          </>
        ) : (
          <>
            <Button
              size="icon"
              variant="ghost"
              aria-label={micOn ? "Desligar microfone" : "Ligar microfone"}
              onClick={toggleMic}
              className="h-14 w-14 rounded-full bg-header-foreground/15 text-header-foreground hover:bg-header-foreground/25"
            >
              {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </Button>
            {kind === "video" && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={camOn ? "Desligar câmera" : "Ligar câmera"}
                onClick={toggleCam}
                className="h-14 w-14 rounded-full bg-header-foreground/15 text-header-foreground hover:bg-header-foreground/25"
              >
                {camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              </Button>
            )}
            <Button
              size="icon"
              aria-label="Encerrar chamada"
              onClick={hangUp}
              className="h-16 w-16 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
