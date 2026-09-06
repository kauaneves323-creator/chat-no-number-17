import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/UserAvatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { extensionOf, uploadMedia } from "@/lib/media";

export const Route = createFileRoute("/_authenticated/perfil")({
  component: ProfilePage,
  head: () => ({
    meta: [
      { title: "Seu perfil · ZapZap" },
      {
        name: "description",
        content: "Troque sua foto, seu nome e seu recado no ZapZap, o app de conversas sem número.",
      },
      { property: "og:title", content: "Seu perfil · ZapZap" },
      {
        property: "og:description",
        content: "Troque sua foto, seu nome e seu recado no ZapZap.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [about, setAbout] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name);
      setAbout(profile.about);
    }
  }, [profile]);

  async function save() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() || profile?.username, about: about.trim() })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar.");
      return;
    }
    await refreshProfile();
    toast.success("Perfil atualizado!");
  }

  async function pickPhoto(file: File | undefined) {
    if (!file || !user) return;
    setUploading(true);
    try {
      const path = await uploadMedia(file, user.id, "avatars", extensionOf(file, "jpg"));
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", user.id);
      if (error) throw new Error(error.message);
      await refreshProfile();
      toast.success("Foto atualizada!");
    } catch {
      toast.error("Não foi possível enviar a foto.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-chat-canvas">
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
        <h1 className="text-base font-semibold">Perfil</h1>
      </header>

      <div className="mx-auto max-w-md space-y-6 p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <UserAvatar
              path={profile?.avatar_url}
              name={profile?.display_name ?? ""}
              className="h-28 w-28 text-2xl"
            />
            <Button
              size="icon"
              className="absolute bottom-0 right-0 rounded-full"
              aria-label="Trocar foto"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void pickPhoto(e.target.files?.[0])}
            />
          </div>
          <p className="text-sm text-muted-foreground">@{profile?.username ?? "…"}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">Seu nome</Label>
          <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="about">Recado</Label>
          <Textarea
            id="about"
            value={about}
            rows={3}
            onChange={(e) => setAbout(e.target.value)}
            placeholder="Disponível"
          />
        </div>

        <Button className="w-full" onClick={() => void save()} disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
