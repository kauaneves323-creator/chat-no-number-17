import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Eye, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/UserAvatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { extensionOf, uploadMedia, useSignedUrl } from "@/lib/media";

export const Route = createFileRoute("/_authenticated/stories")({
  component: StoriesPage,
  head: () => ({
    meta: [
      { title: "Stories · ZapZap" },
      {
        name: "description",
        content: "Publique fotos e recados que desaparecem em 24 horas no ZapZap.",
      },
      { property: "og:title", content: "Stories · ZapZap" },
      {
        property: "og:description",
        content: "Publique fotos e recados que desaparecem em 24 horas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Story = {
  id: string;
  user_id: string;
  media_url: string | null;
  caption: string;
  background: string;
  created_at: string;
  expires_at: string;
  profile: { username: string; display_name: string; avatar_url: string | null } | null;
};

const COLORS = ["#075E54", "#128C7E", "#4C1D95", "#B91C1C", "#0F172A", "#B45309"];

function StoryMedia({ path, alt }: { path: string; alt: string }) {
  const url = useSignedUrl(path);
  if (!url) return <div className="h-full w-full animate-pulse bg-black/30" />;
  return <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />;
}

function StoriesPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const myId = user?.id ?? "";
  const fileRef = useRef<HTMLInputElement>(null);

  const [stories, setStories] = useState<Story[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [file, setFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const [viewing, setViewing] = useState<Story | null>(null);
  const [viewerCounts, setViewerCounts] = useState<Record<string, number>>({});

  async function load() {
    const { data } = await supabase
      .from("stories")
      .select(
        "id, user_id, media_url, caption, background, created_at, expires_at, profiles:user_id(username, display_name, avatar_url)",
      )
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    const rows: Story[] = ((data as any[]) ?? []).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      media_url: row.media_url,
      caption: row.caption,
      background: row.background,
      created_at: row.created_at,
      expires_at: row.expires_at,
      profile: row.profiles ?? null,
    }));
    setStories(rows);

    const mine = rows.filter((s) => s.user_id === myId).map((s) => s.id);
    if (mine.length > 0) {
      const { data: views } = await supabase
        .from("story_views")
        .select("story_id")
        .in("story_id", mine);
      const counts: Record<string, number> = {};
      for (const v of views ?? []) counts[v.story_id] = (counts[v.story_id] ?? 0) + 1;
      setViewerCounts(counts);
    }
  }

  useEffect(() => {
    if (!myId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  const mine = useMemo(() => stories.filter((s) => s.user_id === myId), [stories, myId]);
  const others = useMemo(() => stories.filter((s) => s.user_id !== myId), [stories, myId]);

  async function publish() {
    if (!user) return;
    if (!file && !caption.trim()) {
      toast.info("Escreva algo ou escolha uma foto.");
      return;
    }
    setPosting(true);
    try {
      let path: string | null = null;
      if (file) path = await uploadMedia(file, user.id, "stories", extensionOf(file, "jpg"));
      const { error } = await supabase.from("stories").insert({
        user_id: user.id,
        media_url: path,
        caption: caption.trim(),
        background: color,
      });
      if (error) throw new Error(error.message);
      setComposerOpen(false);
      setCaption("");
      setFile(null);
      await load();
      toast.success("Story publicado! Ele desaparece em 24 horas.");
    } catch {
      toast.error("Não foi possível publicar.");
    } finally {
      setPosting(false);
    }
  }

  async function open(story: Story) {
    setViewing(story);
    if (story.user_id !== myId && myId) {
      await supabase
        .from("story_views")
        .upsert({ story_id: story.id, viewer_id: myId }, { onConflict: "story_id,viewer_id" });
    }
  }

  async function remove(story: Story) {
    await supabase.from("stories").delete().eq("id", story.id);
    setViewing(null);
    await load();
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 bg-header px-3 py-3 text-header-foreground">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Voltar"
          className="text-header-foreground hover:bg-header-foreground/15"
          onClick={() => navigate({ to: "/chats" })}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="flex-1 text-base font-semibold">Stories</h1>
      </header>

      <div className="mx-auto max-w-md p-4">
        <button
          onClick={() => setComposerOpen(true)}
          className="mb-4 flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted"
        >
          <span className="relative">
            <UserAvatar path={profile?.avatar_url} name={profile?.display_name ?? ""} />
            <span className="absolute -bottom-1 -right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
              <Plus className="h-3 w-3" />
            </span>
          </span>
          <span>
            <span className="block text-sm font-medium">Meu story</span>
            <span className="block text-xs text-muted-foreground">
              {mine.length > 0 ? `${mine.length} publicado(s) hoje` : "Toque para publicar"}
            </span>
          </span>
        </button>

        {mine.length > 0 && (
          <section className="mb-6 space-y-1">
            <h2 className="px-1 pb-1 text-xs font-semibold uppercase text-muted-foreground">
              Seus stories
            </h2>
            {mine.map((story) => (
              <button
                key={story.id}
                onClick={() => void open(story)}
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted"
              >
                <span
                  className="h-11 w-11 shrink-0 rounded-full ring-2 ring-primary ring-offset-2 ring-offset-background"
                  style={{ background: story.background }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {story.caption || "Foto"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {new Date(story.created_at).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Eye className="h-3.5 w-3.5" />
                  {viewerCounts[story.id] ?? 0}
                </span>
              </button>
            ))}
          </section>
        )}

        <h2 className="px-1 pb-1 text-xs font-semibold uppercase text-muted-foreground">
          Recentes
        </h2>
        {others.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Ninguém publicou stories nas últimas 24 horas.
          </p>
        )}
        <div className="space-y-1">
          {others.map((story) => (
            <button
              key={story.id}
              onClick={() => void open(story)}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted"
            >
              <span className="rounded-full ring-2 ring-primary ring-offset-2 ring-offset-background">
                <UserAvatar
                  path={story.profile?.avatar_url}
                  name={story.profile?.display_name ?? ""}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {story.profile?.display_name ?? "Alguém"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {new Date(story.created_at).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo story</DialogTitle>
          </DialogHeader>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Escreva algo…"
            rows={3}
          />
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Cor ${c}`}
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full border-2 ${color === c ? "border-primary" : "border-transparent"}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <ImagePlus className="mr-2 h-4 w-4" />
            {file ? file.name : "Adicionar foto"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button onClick={() => void publish()} disabled={posting}>
            {posting ? "Publicando…" : "Publicar"}
          </Button>
        </DialogContent>
      </Dialog>

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex flex-col"
          style={{ background: viewing.background }}
        >
          <div className="flex items-center gap-3 p-4 text-white">
            <UserAvatar
              path={viewing.profile?.avatar_url}
              name={viewing.profile?.display_name ?? ""}
            />
            <div className="flex-1">
              <p className="text-sm font-semibold">
                {viewing.user_id === myId ? "Você" : viewing.profile?.display_name ?? "Alguém"}
              </p>
              <p className="text-xs opacity-80">
                {new Date(viewing.created_at).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            {viewing.user_id === myId && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Apagar story"
                className="text-white hover:bg-white/15"
                onClick={() => void remove(viewing)}
              >
                <Trash2 className="h-5 w-5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Fechar"
              className="text-white hover:bg-white/15"
              onClick={() => setViewing(null)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex flex-1 items-center justify-center p-6">
            {viewing.media_url ? (
              <StoryMedia path={viewing.media_url} alt={viewing.caption || "Story"} />
            ) : (
              <p className="text-center text-2xl font-semibold text-white">{viewing.caption}</p>
            )}
          </div>
          {viewing.media_url && viewing.caption && (
            <p className="p-6 text-center text-white">{viewing.caption}</p>
          )}
        </div>
      )}
    </div>
  );
}
