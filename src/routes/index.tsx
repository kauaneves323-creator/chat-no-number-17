import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { MessageCircle, Phone, Radio } from "lucide-react";
import logo from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ZapZap — conversas em tempo real sem número de telefone" },
      {
        name: "description",
        content:
          "Mensagens instantâneas, status e chamadas com uma conta criada só com nome de usuário. Sem SIM, sem número de telefone.",
      },
      { property: "og:title", content: "ZapZap — converse sem número de telefone" },
      {
        property: "og:description",
        content: "Crie sua conta com um nome de usuário e comece a conversar em segundos.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) navigate({ to: "/chats", replace: true });
  }, [loading, session, navigate]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-header px-6 py-16 text-header-foreground">
      <img src={logo} alt="ZapZap" width={512} height={512} className="h-20 w-20" />
      <h1 className="mt-6 max-w-xl text-center text-4xl font-semibold tracking-tight">
        Converse com quem quiser, sem número de telefone
      </h1>
      <p className="mt-4 max-w-md text-center text-sm opacity-85">
        Escolha um nome de usuário, crie sua senha e pronto: mensagens na hora, do jeito que você
        já conhece.
      </p>
      <Button asChild size="lg" variant="secondary" className="mt-8 rounded-full px-8">
        <Link to="/auth">Começar agora</Link>
      </Button>

      <ul className="mt-14 grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        <li className="rounded-2xl bg-header-foreground/10 p-5">
          <MessageCircle className="h-6 w-6" />
          <p className="mt-3 text-sm font-semibold">Mensagens instantâneas</p>
          <p className="mt-1 text-xs opacity-80">Chegam na hora, sem recarregar a tela.</p>
        </li>
        <li className="rounded-2xl bg-header-foreground/10 p-5">
          <Radio className="h-6 w-6" />
          <p className="mt-3 text-sm font-semibold">Status</p>
          <p className="mt-1 text-xs opacity-80">Em breve: recados que somem em 24 horas.</p>
        </li>
        <li className="rounded-2xl bg-header-foreground/10 p-5">
          <Phone className="h-6 w-6" />
          <p className="mt-3 text-sm font-semibold">Chamadas</p>
          <p className="mt-1 text-xs opacity-80">Em breve: voz e vídeo ao vivo.</p>
        </li>
      </ul>
    </main>
  );
}
