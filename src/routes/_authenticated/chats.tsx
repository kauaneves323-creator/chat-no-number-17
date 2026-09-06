import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CircleUserRound, LogOut, MessageSquarePlus, Radio, Search, Users } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { CallsProvider } from "@/lib/calls";
import { CallOverlay } from "@/components/CallOverlay";
import { UserAvatar } from "@/components/UserAvatar";

export const Route = createFileRoute("/_authenticated/chats")({
  component: ChatsShell,
});

function ChatsShell() {
  return (
    <CallsProvider>
      <ChatsLayout />
      <CallOverlay />
    </CallsProvider>
  );
}


type ChatRow = {
  id: string;
  name: string | null;
  is_group: boolean;
  last_message_at: string;
  members: {
    user_id: string;
    profile: { username: string; display_name: string; avatar_url: string | null } | null;
  }[];
  preview: string | null;
};

function chatAvatar(chat: ChatRow, myId: string) {
  if (chat.is_group) return null;
  return chat.members.find((m) => m.user_id !== myId)?.profile?.avatar_url ?? null;
}

export function chatTitle(chat: ChatRow, myId: string) {
  if (chat.is_group) return chat.name ?? "Grupo";
  const other = chat.members.find((m) => m.user_id !== myId);
  return other?.profile?.display_name ?? "Conversa";
}

function ChatsLayout() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inConversation = pathname !== "/chats";

  const [chats, setChats] = useState<ChatRow[]>([]);
  const [filter, setFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupPicked, setGroupPicked] = useState<string[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ id: string; username: string; display_name: string }[]>(
    [],
  );

  const myId = user?.id ?? "";

  async function loadChats() {
    if (!myId) return;
    const { data: memberships } = await supabase
      .from("chat_members")
      .select("chat_id")
      .eq("user_id", myId);
    const ids = (memberships ?? []).map((m) => m.chat_id);
    if (ids.length === 0) {
      setChats([]);
      return;
    }
    const { data } = await supabase
      .from("chats")
      .select(
        "id, name, is_group, last_message_at, chat_members(user_id, profiles(username, display_name, avatar_url)), messages(content, created_at, media_type)",
      )
      .in("id", ids)
      .order("last_message_at", { ascending: false });

    const mapped: ChatRow[] = (data ?? []).map((row: any) => {
      const msgs = (row.messages ?? [])
        .slice()
        .sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));
      return {
        id: row.id,
        name: row.name,
        is_group: row.is_group,
        last_message_at: row.last_message_at,
        members: (row.chat_members ?? []).map((m: any) => ({
          user_id: m.user_id,
          profile: m.profiles,
        })),
        preview:
          msgs[0]?.content ||
          (msgs[0]?.media_type === "audio"
            ? "🎤 Áudio"
            : msgs[0]?.media_type === "image"
              ? "📷 Foto"
              : null),
      };
    });
    setChats(mapped);
  }

  useEffect(() => {
    void loadChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      .channel("chat-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        void loadChats();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_members" }, () => {
        void loadChats();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  useEffect(() => {
    if (!dialogOpen && !groupOpen) return;
    const term = search.trim().toLowerCase();
    let active = true;
    const run = async () => {
      const query = supabase
        .from("profiles")
        .select("id, username, display_name")
        .neq("id", myId)
        .limit(20);
      const { data } = term
        ? await query.or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
        : await query;
      if (active) setResults(data ?? []);
    };
    void run();
    return () => {
      active = false;
    };
  }, [search, dialogOpen, groupOpen, myId]);

  async function startChat(otherId: string) {
    const existing = chats.find(
      (c) => !c.is_group && c.members.some((m) => m.user_id === otherId) && c.members.length === 2,
    );
    if (existing) {
      setDialogOpen(false);
      navigate({ to: "/chats/$chatId", params: { chatId: existing.id } });
      return;
    }
    const { data: chat, error } = await supabase
      .from("chats")
      .insert({ created_by: myId, is_group: false })
      .select("id")
      .single();
    if (error || !chat) {
      toast.error("Não foi possível iniciar a conversa.");
      return;
    }
    const { error: memberError } = await supabase
      .from("chat_members")
      .insert([
        { chat_id: chat.id, user_id: myId },
        { chat_id: chat.id, user_id: otherId },
      ]);
    if (memberError) {
      toast.error("Não foi possível adicionar os participantes.");
      return;
    }
    setDialogOpen(false);
    await loadChats();
    navigate({ to: "/chats/$chatId", params: { chatId: chat.id } });
  }

  async function createGroup() {
    const name = groupName.trim();
    if (!name || groupPicked.length === 0) {
      toast.info("Dê um nome ao grupo e escolha pelo menos uma pessoa.");
      return;
    }
    setCreatingGroup(true);
    const { data: chat, error } = await supabase
      .from("chats")
      .insert({ created_by: myId, is_group: true, name })
      .select("id")
      .single();
    if (error || !chat) {
      setCreatingGroup(false);
      toast.error("Não foi possível criar o grupo.");
      return;
    }
    const { error: memberError } = await supabase.from("chat_members").insert([
      { chat_id: chat.id, user_id: myId },
      ...groupPicked.map((id) => ({ chat_id: chat.id, user_id: id })),
    ]);
    setCreatingGroup(false);
    if (memberError) {
      toast.error("Não foi possível adicionar todo mundo.");
      return;
    }
    setGroupOpen(false);
    setGroupName("");
    setGroupPicked([]);
    await loadChats();
    navigate({ to: "/chats/$chatId", params: { chatId: chat.id } });
  }

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return chats;
    return chats.filter((c) => chatTitle(c, myId).toLowerCase().includes(term));
  }, [chats, filter, myId]);

  return (
    <div className="flex h-screen bg-chat-canvas">
      <aside
        className={`${inConversation ? "hidden md:flex" : "flex"} h-full w-full flex-col border-r border-border bg-background md:w-[360px] md:shrink-0`}
      >
        <header className="flex items-center gap-2 bg-header px-4 py-3 text-header-foreground">
          <img src={logo} alt="" width={512} height={512} className="h-8 w-8" />
          <div className="flex-1">
            <p className="text-base font-semibold leading-tight">ZapZap</p>
            <p className="text-xs opacity-80">@{profile?.username ?? "…"}</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-header-foreground hover:bg-header-foreground/15"
                aria-label="Nova conversa"
              >
                <MessageSquarePlus className="h-5 w-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova conversa</DialogTitle>
              </DialogHeader>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome de usuário"
              />
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {results.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Ninguém encontrado.
                  </p>
                )}
                {results.map((person) => (
                  <button
                    key={person.id}
                    onClick={() => void startChat(person.id)}
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted"
                  >
                    <UserAvatar name={person.display_name} />
                    <span>
                      <span className="block text-sm font-medium">{person.display_name}</span>
                      <span className="block text-xs text-muted-foreground">
                        @{person.username}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-header-foreground hover:bg-header-foreground/15"
                aria-label="Novo grupo"
              >
                <Users className="h-5 w-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo grupo</DialogTitle>
              </DialogHeader>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Nome do grupo"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar pessoas"
              />
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {results.map((person) => {
                  const picked = groupPicked.includes(person.id);
                  return (
                    <button
                      key={person.id}
                      onClick={() =>
                        setGroupPicked((prev) =>
                          picked ? prev.filter((id) => id !== person.id) : [...prev, person.id],
                        )
                      }
                      className={`flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors ${picked ? "bg-muted" : "hover:bg-muted"}`}
                    >
                      <UserAvatar name={person.display_name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {person.display_name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          @{person.username}
                        </span>
                      </span>
                      {picked && <span className="text-xs text-primary">selecionado</span>}
                    </button>
                  );
                })}
              </div>
              <Button onClick={() => void createGroup()} disabled={creatingGroup}>
                {creatingGroup ? "Criando…" : `Criar grupo (${groupPicked.length})`}
              </Button>
            </DialogContent>
          </Dialog>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Stories"
            className="text-header-foreground hover:bg-header-foreground/15"
            onClick={() => navigate({ to: "/stories" })}
          >
            <Radio className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Meu perfil"
            className="text-header-foreground hover:bg-header-foreground/15"
            onClick={() => navigate({ to: "/perfil" })}
          >
            <CircleUserRound className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sair"
            className="text-header-foreground hover:bg-header-foreground/15"
            onClick={async () => {
              await signOut();
              navigate({ to: "/auth", replace: true });
            }}
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </header>

        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Pesquisar conversas"
              className="pl-9"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto">
          {visible.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma conversa ainda. Toque no ícone de nova conversa para começar.
            </p>
          )}
          {visible.map((chat) => (
            <Link
              key={chat.id}
              to="/chats/$chatId"
              params={{ chatId: chat.id }}
              activeProps={{ className: "bg-muted" }}
              className="flex items-center gap-3 border-b border-border/60 px-4 py-3 transition-colors hover:bg-muted"
            >
              <UserAvatar path={chatAvatar(chat, myId)} name={chatTitle(chat, myId)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {chatTitle(chat, myId)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {chat.preview ?? "Diga olá 👋"}
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground">
                {new Date(chat.last_message_at).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </Link>
          ))}
        </nav>
      </aside>

      <section className={`${inConversation ? "flex" : "hidden md:flex"} h-full flex-1`}>
        <Outlet />
      </section>
    </div>
  );
}
