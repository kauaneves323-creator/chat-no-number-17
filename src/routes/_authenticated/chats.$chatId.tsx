import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Phone, Send, Video } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useCalls } from "@/lib/calls";

export const Route = createFileRoute("/_authenticated/chats/$chatId")({
  component: ChatRoom,
});

type Message = {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ChatRoom() {
  const { chatId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const myId = user?.id ?? "";

  const [messages, setMessages] = useState<Message[]>([]);
  const [title, setTitle] = useState("Conversa");
  const [subtitle, setSubtitle] = useState("");
  const [otherId, setOtherId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const { startCall } = useCalls();

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data: chat } = await supabase
        .from("chats")
        .select("id, name, is_group, chat_members(user_id, profiles(username, display_name))")
        .eq("id", chatId)
        .maybeSingle();
      if (!active) return;
      if (chat) {
        const row = chat as any;
        if (row.is_group) {
          setTitle(row.name ?? "Grupo");
          setSubtitle(`${row.chat_members?.length ?? 0} participantes`);
          setOtherId(null);
        } else {
          const other = (row.chat_members ?? []).find((m: any) => m.user_id !== myId);
          setTitle(other?.profiles?.display_name ?? "Conversa");
          setSubtitle(other?.profiles?.username ? `@${other.profiles.username}` : "");
          setOtherId(other?.user_id ?? null);
        }
      }
      const { data } = await supabase
        .from("messages")
        .select("id, chat_id, sender_id, content, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });
      if (active) setMessages((data as Message[]) ?? []);
    };
    void load();
    return () => {
      active = false;
    };
  }, [chatId, myId]);

  useEffect(() => {
    const channel = supabase
      .channel(`room-${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const incoming = payload.new as Message;
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const { error } = await supabase
      .from("messages")
      .insert({ chat_id: chatId, sender_id: myId, content: text });
    if (error) {
      toast.error("A mensagem não foi enviada.");
      setDraft(text);
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center gap-3 bg-header px-3 py-2 text-header-foreground">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Voltar"
          className="text-header-foreground hover:bg-header-foreground/15 md:hidden"
          onClick={() => navigate({ to: "/chats" })}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Avatar>
          <AvatarFallback>{initials(title)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{title}</p>
          <p className="truncate text-xs opacity-80">{subtitle}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Chamada de vídeo"
          className="text-header-foreground hover:bg-header-foreground/15"
          onClick={() => toast.info("Chamadas de vídeo chegam na próxima etapa.")}
        >
          <Video className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Chamada de voz"
          className="text-header-foreground hover:bg-header-foreground/15"
          onClick={() => toast.info("Chamadas de voz chegam na próxima etapa.")}
        >
          <Phone className="h-5 w-5" />
        </Button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto bg-chat-canvas px-3 py-4 md:px-8">
        {messages.length === 0 && (
          <p className="pt-10 text-center text-sm text-muted-foreground">
            Nenhuma mensagem ainda. Mande a primeira!
          </p>
        )}
        {messages.map((message) => {
          const mine = message.sender_id === myId;
          return (
            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
                  mine
                    ? "bg-bubble-out text-bubble-out-foreground rounded-br-sm"
                    : "bg-bubble-in text-bubble-in-foreground rounded-bl-sm"
                }`}
              >
                <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                <p className="mt-1 text-right text-[10px] opacity-60">
                  {new Date(message.created_at).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="flex items-center gap-2 border-t border-border bg-background p-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Mensagem"
          className="rounded-full"
        />
        <Button type="submit" size="icon" className="rounded-full" aria-label="Enviar">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
