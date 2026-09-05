import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import logo from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { normalizeUsername, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar no ZapZap — conversas sem número de telefone" },
      {
        name: "description",
        content:
          "Crie sua conta apenas com um nome de usuário e converse em tempo real, sem precisar de número de telefone.",
      },
      { property: "og:title", content: "Entrar no ZapZap" },
      {
        property: "og:description",
        content: "Conta criada só com nome de usuário. Converse na hora, sem número de telefone.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { session, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [newUser, setNewUser] = useState("");
  const [newName, setNewName] = useState("");
  const [newPass, setNewPass] = useState("");

  useEffect(() => {
    if (session) navigate({ to: "/chats", replace: true });
  }, [session, navigate]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await signIn(loginUser, loginPass);
      navigate({ to: "/chats", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    const clean = normalizeUsername(newUser);
    if (clean.length < 3) {
      toast.error("Escolha um nome de usuário com pelo menos 3 letras.");
      return;
    }
    if (newPass.length < 6) {
      toast.error("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await signUp(clean, newPass, newName);
      toast.success("Conta criada! Bem-vindo.");
      navigate({ to: "/chats", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a conta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-header">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-3xl bg-card p-6 shadow-2xl">
          <div className="flex flex-col items-center gap-2 pb-6 text-center">
            <img src={logo} alt="ZapZap" width={512} height={512} className="h-14 w-14" />
            <h1 className="text-2xl font-semibold">ZapZap</h1>
            <p className="text-sm text-muted-foreground">
              Só um nome de usuário. Sem número de telefone.
            </p>
          </div>

          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="login-user">Nome de usuário</Label>
                  <Input
                    id="login-user"
                    value={loginUser}
                    onChange={(e) => setLoginUser(e.target.value)}
                    placeholder="joao.silva"
                    autoComplete="username"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-pass">Senha</Label>
                  <Input
                    id="login-pass"
                    type="password"
                    value={loginPass}
                    onChange={(e) => setLoginPass(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Entrando…" : "Entrar"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="new-user">Nome de usuário</Label>
                  <Input
                    id="new-user"
                    value={newUser}
                    onChange={(e) => setNewUser(e.target.value)}
                    placeholder="joao.silva"
                    autoComplete="username"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-name">Como quer aparecer</Label>
                  <Input
                    id="new-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="João Silva"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-pass">Senha</Label>
                  <Input
                    id="new-pass"
                    type="password"
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Criando…" : "Criar conta"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Guarde bem a sua senha: sem e-mail cadastrado, não há como recuperá-la.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </main>
  );
}
