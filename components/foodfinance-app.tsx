"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  CreditCard,
  Download,
  Factory,
  FileBarChart2,
  Info,
  Lightbulb,
  Lock,
  LogOut,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  ShoppingBasket,
  Sparkles,
  Store,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type SyntheticEvent } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";

type Section =
  | "dashboard"
  | "transactions"
  | "commitments"
  | "products"
  | "recipes"
  | "suppliers"
  | "reports"
  | "insights"
  | "companies"
  | "plans"
  | "admin";
type DialogMode = "sale" | "expense" | "payable" | "receivable" | "product" | "supplier" | "recipe";
type Organization = { id: string; name: string; created_at: string };
type Entry = {
  id: string;
  kind: "sale" | "expense";
  amount: number;
  category: string;
  description: string;
  occurred_on: string;
  payment_method: string | null;
};
type Product = {
  id: string;
  name: string;
  category: string;
  unit: string;
  cost_per_unit: number;
  sale_price: number;
  stock_quantity: number;
  minimum_stock: number;
};
type Supplier = { id: string; name: string; contact_name: string | null; email: string | null; phone: string | null; category: string | null };
type Commitment = { id: string; kind: "payable" | "receivable"; party_name: string; description: string; amount: number; due_date: string; status: "open" | "paid" };
type Entitlement = { is_admin: boolean; has_access: boolean; plan_key: string | null; status: string | null; trial_ends_at: string | null; access_until: string | null };
type RecipeIngredient = { quantity: number; product: { name: string; unit: string; cost_per_unit: number } | null };
type Recipe = { id: string; name: string; selling_price: number; recipe_ingredients: RecipeIngredient[] };
type Draft = Record<string, string>;
type IngredientLine = { product_id: string; quantity: string };

const navigation: { id: Section; label: string; icon: LucideIcon; group: "GESTÃO" | "CARDÁPIO" | "ANÁLISES" | "CONTA"; hint: string }[] = [
  { id: "dashboard", label: "Visão geral", icon: Activity, group: "GESTÃO", hint: "Resumo do mês: faturamento, despesas, lucro e gráficos para enxergar a saúde financeira do negócio." },
  { id: "transactions", label: "Movimentações", icon: ArrowLeftRight, group: "GESTÃO", hint: "Todas as vendas e despesas lançadas. Aqui você registra, busca e exclui movimentações." },
  { id: "commitments", label: "Contas a pagar e receber", icon: CalendarDays, group: "GESTÃO", hint: "Contas a pagar (fornecedores, boletos) e a receber (clientes), com vencimento e situação." },
  { id: "products", label: "Produtos e estoque", icon: Package, group: "CARDÁPIO", hint: "Cadastro de produtos e insumos com custo, preço e estoque. Avisa quando o estoque está baixo." },
  { id: "recipes", label: "Fichas técnicas", icon: ClipboardList, group: "CARDÁPIO", hint: "Receitas com os ingredientes de cada prato, para calcular o custo e a margem de cada um." },
  { id: "suppliers", label: "Fornecedores", icon: Factory, group: "CARDÁPIO", hint: "Lista de fornecedores com contato e categoria." },
  { id: "reports", label: "Relatórios", icon: FileBarChart2, group: "ANÁLISES", hint: "Resultado e margem do mês, histórico dos últimos 6 meses e exportação em CSV." },
  { id: "insights", label: "Análises", icon: Sparkles, group: "ANÁLISES", hint: "Observações automáticas calculadas a partir dos seus lançamentos, estoque e contas." },
  { id: "companies", label: "Empresas", icon: Store, group: "CONTA", hint: "Crie, renomeie e troque entre suas empresas. Os dados de cada uma ficam separados." },
  { id: "plans", label: "Assinatura", icon: CreditCard, group: "CONTA", hint: "Veja o status da sua assinatura e assine o Plano Bronze para liberar todos os recursos." },
];

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const errorText = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação.";
const toDateInputValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const checkoutUrl = process.env.NEXT_PUBLIC_KIWIFY_CHECKOUT_URL || "https://pay.kiwify.com.br/QK5M00V";

const mobileLabels: Record<Section, string> = {
  dashboard: "Início",
  transactions: "Movimentos",
  commitments: "Contas",
  products: "Estoque",
  recipes: "Fichas",
  suppliers: "Fornecedores",
  reports: "Relatórios",
  insights: "Análises",
  companies: "Empresas",
  plans: "Assinatura",
  admin: "Admin",
};

function accessLabel(entitlement: Entitlement | null) {
  if (!entitlement) return "Ver assinatura";
  if (entitlement.is_admin) return "Acesso de administrador";
  switch (entitlement.status) {
    case "active": return entitlement.has_access ? "Assinatura ativa" : "Assinatura vencida";
    case "trial": return entitlement.has_access ? "Período de avaliação" : "Avaliação encerrada";
    case "past_due": return "Pagamento pendente";
    case "canceled": return "Assinatura cancelada";
    case "incomplete": return "Sem assinatura";
    default: return entitlement.has_access ? "Acesso liberado" : "Sem assinatura";
  }
}

type TipState = { top: number; left: number; width: number; above: boolean; side: "bottom" | "right" };

function useTip(text: string, side: "bottom" | "right" = "bottom") {
  const id = useId();
  const anchor = useRef<Element | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const hide = useCallback(() => { anchor.current = null; setTip(null); }, []);
  const show = useCallback((event: SyntheticEvent<HTMLElement>) => {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const width = Math.min(250, window.innerWidth - 24);
    const centered = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
    const left = side === "right" ? Math.min(rect.right + 10, window.innerWidth - width - 12) : centered;
    const above = side === "bottom" && rect.bottom + 130 > window.innerHeight && rect.top > 140;
    const top = side === "right" ? rect.top + rect.height / 2 : above ? rect.top - 8 : rect.bottom + 8;
    anchor.current = element;
    setTip({ top, left, width, above, side });
  }, [side]);

  useEffect(() => {
    if (!tip) return;
    const onPointerDown = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node)) hide(); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tip, hide]);

  const bubble = tip ? <span id={id} role="tooltip" className="tip-bubble" style={{ top: tip.top, left: tip.left, width: tip.width, transform: tip.side === "right" ? "translateY(-50%)" : tip.above ? "translateY(-100%)" : undefined }}>{text}</span> : null;
  return { id, open: Boolean(tip), hide, bubble, bind: { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide, onClick: show } };
}

function Hint({ text, label = "O que significa?" }: { text: string; label?: string }) {
  const tip = useTip(text);
  return <span className="hint"><button type="button" className="hint-trigger" aria-label={label} aria-describedby={tip.open ? tip.id : undefined} {...tip.bind}><Info size={12} /></button>{tip.bubble}</span>;
}

function Tip({ text, className, children }: { text: string; className?: string; children: ReactNode }) {
  const tip = useTip(text);
  return <div className={className} aria-describedby={tip.open ? tip.id : undefined} {...tip.bind}>{children}{tip.bubble}</div>;
}

function NavLinkButton({ label, hint, icon: Icon, active, locked, onSelect }: { label: string; hint: string; icon: LucideIcon; active: boolean; locked: boolean; onSelect: () => void }) {
  const tip = useTip(hint, "right");
  return <button className={`nav-link ${active ? "active" : ""}`} aria-describedby={tip.open ? tip.id : undefined} onMouseEnter={tip.bind.onMouseEnter} onMouseLeave={tip.bind.onMouseLeave} onFocus={tip.bind.onFocus} onBlur={tip.bind.onBlur} onClick={() => { tip.hide(); onSelect(); }}><Icon size={16} strokeWidth={1.8} /><span>{label}</span>{locked && <Lock size={11} className="nav-lock" aria-label="Disponível somente com assinatura" />}{tip.bubble}</button>;
}

function PanelTitle({ title, hint }: { title: string; hint: string }) {
  return <div className="panel-title-row"><h2 className="panel-title">{title}</h2><Hint text={hint} label={`O que significa ${title}?`} /></div>;
}

function LegendRow({ name, value, total, color, kind }: { name: string; value: number; total: number; color: string; kind: "receitas" | "despesas" }) {
  const percent = total ? Math.round((value / total) * 100) : 0;
  return <Tip className="category-legend-row" text={`${name}: ${currency.format(value)}, ${percent}% das ${kind} do mês.`}><i style={{ background: color }} /><span>{name}</span><strong>{percent}%</strong></Tip>;
}

function AuthScreen({ client }: { client: ReturnType<typeof getSupabaseClient> }) {
  const [mode, setMode] = useState<"signin" | "signup" | "recover">("signin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      if (mode === "signin") {
        const { error: authError } = await client.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
      } else if (mode === "signup") {
        const businessName = String(form.get("business") ?? "").trim();
        const { data, error: authError } = await client.auth.signUp({
          email,
          password,
          options: { data: { business_name: businessName || "Minha empresa" } },
        });
        if (authError) throw authError;
        if (!data.session) setMessage("Cadastro criado. Confira seu e-mail para confirmar a conta e depois entre.");
      } else {
        const { error: authError } = await client.auth.resetPasswordForEmail(email);
        if (authError) throw authError;
        setMessage("Se houver uma conta com este e-mail, enviaremos um link de recuperação.");
      }
    } catch (authError) {
      setError(errorText(authError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-brand-panel">
        <div className="brand"><div className="brand-mark"><ChefHat size={20} /><span className="brand-trend"><TrendingUp size={11} /></span></div><div><div className="brand-name">Food<span>Finance</span></div><div className="brand-tag">Gestão que dá lucro</div></div></div>
        <div className="auth-message">
          <div className="eyebrow">Finanças para quem alimenta</div>
          <h1>Mais clareza.<br />Mais <span>margem.</span></h1>
          <p>As decisões certas começam quando você enxerga o que acontece em cada prato, conta e venda.</p>
        </div>
        <div className="auth-footnote">Controle financeiro feito para a realidade do seu negócio.</div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-box">
          <div className="brand" style={{ padding: "0 0 24px" }}><div className="brand-mark"><ChefHat size={20} /><span className="brand-trend"><TrendingUp size={11} /></span></div><div><div className="brand-name">Food<span>Finance</span></div><div className="brand-tag">Gestão que dá lucro</div></div></div>
          {!client ? (
            <>
              <h2>Conecte seu projeto</h2>
              <p>A integração está pronta; falta apontar para o seu projeto Supabase.</p>
              <div className="notice">A Project URL não foi informada. A chave publicável sozinha não identifica o projeto.</div>
              <ul className="setup-list">
                <li><Check size={14} /> Defina <code>NEXT_PUBLIC_SUPABASE_URL</code> com a URL do projeto.</li>
                <li><Check size={14} /> Defina <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> com a chave informada.</li>
                <li><Check size={14} /> Aplique a migration <code>supabase/migrations/202611030001_initial_schema.sql</code>.</li>
                <li><Check size={14} /> Reinicie o servidor para habilitar login e dados.</li>
              </ul>
            </>
          ) : (
            <>
              <h2>{mode === "signin" ? "Bem-vindo de volta" : mode === "signup" ? "Abra sua conta" : "Recuperar acesso"}</h2>
              <p>{mode === "signin" ? "Entre para acompanhar a saúde financeira do negócio." : mode === "signup" ? "Sua conta começa com um espaço seguro para a empresa." : "Enviaremos um link para redefinir sua senha."}</p>
              <form className="auth-fields" onSubmit={submit}>
                {mode === "signup" && <div className="field"><label htmlFor="business">Nome do negócio</label><input id="business" name="business" className="input" placeholder="Ex.: Casa do Forno" autoComplete="organization" /></div>}
                <div className="field"><label htmlFor="auth-email">E-mail</label><input id="auth-email" name="email" className="input" type="email" autoComplete="email" required placeholder="voce@empresa.com" /></div>
                {mode !== "recover" && <div className="field"><label htmlFor="auth-password">Senha</label><input id="auth-password" name="password" className="input" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required placeholder="Mínimo de 8 caracteres" /></div>}
                {error && <div className="error-message" role="alert">{error}</div>}
                {message && <div className="success-message" role="status">{message}</div>}
                <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Aguarde..." : mode === "signin" ? "Entrar" : mode === "signup" ? "Criar conta" : "Enviar link de recuperação"}</button>
              </form>
              <div className="auth-switch">
                {mode === "signin" ? <><button className="text-button" onClick={() => { setMode("recover"); setMessage(""); setError(""); }}>Esqueci minha senha</button><div style={{ marginTop: 13 }}>Ainda não tem conta? <button className="text-button" onClick={() => { setMode("signup"); setMessage(""); setError(""); }}>Cadastre-se</button></div></> : <button className="text-button" onClick={() => { setMode("signin"); setMessage(""); setError(""); }}>Voltar para entrar</button>}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><Icon size={22} /><h3>{title}</h3><p>{description}</p>{action && <div style={{ marginTop: 15 }}>{action}</div>}</div>;
}

function Metric({ icon: Icon, label, value, note, tone, hint }: { icon: LucideIcon; label: string; value: string; note: string; tone?: string; hint?: string }) {
  const tip = useTip(hint ?? "");
  return <div className={`metric-card ${hint ? "has-tip" : ""}`} aria-describedby={hint && tip.open ? tip.id : undefined} {...(hint ? tip.bind : {})}><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={15} /></span></div><div className={`metric-value ${tone ?? ""}`}>{value}</div><div className="metric-note">{note}</div>{hint ? tip.bubble : null}</div>;
}

function RecordDialog({ mode, products, onClose, onSave }: { mode: DialogMode; products: Product[]; onClose: () => void; onSave: (draft: Draft, ingredients: IngredientLine[]) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [todayValue, setTodayValue] = useState("");
  const [ingredients, setIngredients] = useState<IngredientLine[]>([{ product_id: products[0]?.id ?? "", quantity: "1" }]);
  const titles: Record<DialogMode, string> = { sale: "Registrar venda", expense: "Registrar despesa", payable: "Nova conta a pagar", receivable: "Nova conta a receber", product: "Cadastrar produto", supplier: "Cadastrar fornecedor", recipe: "Nova ficha técnica" };

  useEffect(() => {
    const timer = window.setTimeout(() => setTodayValue(toDateInputValue(new Date())), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const draft = Object.fromEntries(new FormData(event.currentTarget).entries()) as Draft;
    try {
      await onSave(draft, ingredients);
      onClose();
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="record-title">
      <div className="modal-header"><div><h2 className="modal-title" id="record-title">{titles[mode]}</h2><p className="modal-description">Os dados serão salvos na empresa selecionada.</p></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={16} /></button></div>
      <form onSubmit={submit}>
        <div className="form-grid">
          {(mode === "sale" || mode === "expense") && <>
            <div className="field form-span"><label htmlFor="description">Descrição</label><input id="description" name="description" className="input" required maxLength={140} placeholder={mode === "sale" ? "Ex.: Vendas do balcão" : "Ex.: Compra de ingredientes"} /></div>
            <div className="field"><label htmlFor="amount">Valor (R$)</label><input id="amount" name="amount" className="input" type="number" min="0.01" step="0.01" required /></div>
            <div className="field"><label htmlFor="category">Categoria</label><input id="category" name="category" className="input" required maxLength={60} placeholder={mode === "sale" ? "Balcão, delivery..." : "Insumos, aluguel..."} /></div>
            <div className="field"><label htmlFor="occurred_on">Data</label><input id="occurred_on" name="occurred_on" className="input" type="date" defaultValue={todayValue} required /></div>
            <div className="field"><label htmlFor="payment_method">Forma de pagamento</label><select id="payment_method" name="payment_method" className="select" defaultValue=""><option value="">Não informado</option><option>Dinheiro</option><option>Pix</option><option>Cartão de débito</option><option>Cartão de crédito</option><option>Aplicativo</option><option>Outro</option></select></div>
          </>}
          {(mode === "payable" || mode === "receivable") && <>
            <div className="field form-span"><label htmlFor="party_name">{mode === "payable" ? "Fornecedor / favorecido" : "Cliente / origem"}</label><input id="party_name" name="party_name" className="input" required maxLength={120} /></div>
            <div className="field form-span"><label htmlFor="commitment-description">Descrição</label><input id="commitment-description" name="description" className="input" required maxLength={140} /></div>
            <div className="field"><label htmlFor="commitment-amount">Valor (R$)</label><input id="commitment-amount" name="amount" className="input" type="number" min="0.01" step="0.01" required /></div>
            <div className="field"><label htmlFor="due_date">Vencimento</label><input id="due_date" name="due_date" className="input" type="date" required /></div>
          </>}
          {mode === "product" && <>
            <div className="field form-span"><label htmlFor="product-name">Nome do produto ou insumo</label><input id="product-name" name="name" className="input" required maxLength={100} /></div>
            <div className="field"><label htmlFor="product-category">Categoria</label><input id="product-category" name="category" className="input" placeholder="Insumo, bebida..." maxLength={60} /></div>
            <div className="field"><label htmlFor="product-unit">Unidade</label><select id="product-unit" name="unit" className="select"><option value="un">Unidade</option><option value="kg">Quilograma</option><option value="g">Grama</option><option value="L">Litro</option><option value="ml">Mililitro</option><option value="cx">Caixa</option></select></div>
            <div className="field"><label htmlFor="cost_per_unit">Custo por unidade (R$)</label><input id="cost_per_unit" name="cost_per_unit" className="input" type="number" min="0" step="0.0001" defaultValue="0" required /></div>
            <div className="field"><label htmlFor="sale_price">Preço de venda (R$)</label><input id="sale_price" name="sale_price" className="input" type="number" min="0" step="0.01" defaultValue="0" required /></div>
            <div className="field"><label htmlFor="stock_quantity">Estoque atual</label><input id="stock_quantity" name="stock_quantity" className="input" type="number" min="0" step="0.001" defaultValue="0" required /></div>
            <div className="field"><label htmlFor="minimum_stock">Alerta abaixo de</label><input id="minimum_stock" name="minimum_stock" className="input" type="number" min="0" step="0.001" defaultValue="0" required /></div>
          </>}
          {mode === "supplier" && <>
            <div className="field form-span"><label htmlFor="supplier-name">Nome do fornecedor</label><input id="supplier-name" name="name" className="input" required maxLength={120} /></div>
            <div className="field"><label htmlFor="contact_name">Pessoa de contato</label><input id="contact_name" name="contact_name" className="input" maxLength={100} /></div>
            <div className="field"><label htmlFor="supplier-category">Categoria</label><input id="supplier-category" name="category" className="input" placeholder="Hortifruti, bebidas..." maxLength={60} /></div>
            <div className="field"><label htmlFor="supplier-email">E-mail</label><input id="supplier-email" name="email" className="input" type="email" /></div>
            <div className="field"><label htmlFor="supplier-phone">Telefone</label><input id="supplier-phone" name="phone" className="input" type="tel" /></div>
          </>}
          {mode === "recipe" && <>
            <div className="field form-span"><label htmlFor="recipe-name">Nome do prato ou produto</label><input id="recipe-name" name="name" className="input" required maxLength={100} /></div>
            <div className="field form-span"><label htmlFor="recipe-price">Preço de venda (R$)</label><input id="recipe-price" name="selling_price" className="input" type="number" min="0.01" step="0.01" required /></div>
            <div className="field form-span"><label>Ingredientes</label>
              {products.length === 0 ? <div className="notice">Cadastre produtos e custos antes de montar uma ficha técnica.</div> : <div style={{ display: "grid", gap: 8 }}>
                {ingredients.map((line, index) => <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 100px 32px", gap: 7 }}>
                  <select className="select" aria-label={`Ingrediente ${index + 1}`} value={line.product_id} onChange={(event) => setIngredients((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, product_id: event.target.value } : item))}><option value="">Selecione um produto</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} ({currency.format(product.cost_per_unit)}/{product.unit})</option>)}</select>
                  <input className="input" aria-label={`Quantidade ${index + 1}`} type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => setIngredients((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} />
                  <button className="icon-button" type="button" aria-label="Remover ingrediente" disabled={ingredients.length === 1} onClick={() => setIngredients((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button>
                </div>)}
                <button className="button button-secondary" type="button" style={{ justifySelf: "start" }} onClick={() => setIngredients((current) => [...current, { product_id: products[0]?.id ?? "", quantity: "1" }])}><Plus size={14} /> Adicionar ingrediente</button>
              </div>}
            </div>
          </>}
        </div>
        {error && <div className="error-message" role="alert" style={{ marginTop: 14 }}>{error}</div>}
        <div className="modal-footer"><button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy || (mode === "recipe" && products.length === 0)}>{busy ? "Salvando..." : "Salvar"}</button></div>
      </form>
    </section>
  </div>;
}

export default function FoodFinanceApp() {
  const client = getSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(client));
  const [section, setSection] = useState<Section>("dashboard");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [role, setRole] = useState("member");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [subscription, setSubscription] = useState<Entitlement | null>(null);
  const [loadedOrganizationId, setLoadedOrganizationId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [today, setToday] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [pageError, setPageError] = useState("");
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const currentDate = new Date();
      setToday(currentDate);
      setSelectedMonth(`${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!client) return;
    let active = true;
    void client.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setAuthLoading(false); } });
    const { data: { subscription: authSubscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
      if (!nextSession) {
        setOrganizations([]); setOrganization(null); setEntries([]); setProducts([]);
        setSuppliers([]); setCommitments([]); setRecipes([]); setSubscription(null);
        setLoadedOrganizationId(null); setIsPlatformAdmin(false); setRole("member");
      }
    });
    return () => { active = false; authSubscription.unsubscribe(); };
  }, [client]);

  useEffect(() => {
    if (!client || !session?.user) return;
    let active = true;
    void (async () => {
      const [{ data, error }, { data: memberData }, { data: adminData }] = await Promise.all([
        client.from("organizations").select("id,name,created_at").order("created_at", { ascending: true }),
        client.from("organization_members").select("organization_id,role").eq("user_id", session.user.id),
        client.rpc("is_platform_admin"),
      ]);
      if (!active) return;
      if (error) setPageError(error.message);
      const companyList = (data ?? []) as Organization[];
      setOrganizations(companyList);
      setOrganization((current) => {
        const next = companyList.find((item) => item.id === current?.id) ?? companyList[0] ?? null;
        const membership = (memberData ?? []).find((item: { organization_id: string }) => item.organization_id === (next?.id ?? ""));
        setRole(membership?.role ?? "member");
        return next;
      });
      setIsPlatformAdmin(Boolean(adminData));
    })();
    return () => { active = false; };
  }, [client, session]);

  useEffect(() => {
    if (!client || !session?.user || !organization) return;
    let active = true;
    void (async () => {
      const orgId = organization.id;
      const { data: entitlementData, error: entitlementError } = await client.rpc("get_org_entitlement", { target_organization_id: orgId });
      if (!active) return;
      if (entitlementError) {
        setPageError(entitlementError.message);
        setSubscription(null);
        setEntries([]); setProducts([]); setSuppliers([]); setCommitments([]); setRecipes([]);
        setLoadedOrganizationId(orgId);
        return;
      }
      const entitlement = entitlementData as Entitlement;
      setSubscription(entitlement);
      const { data: membership } = await client.from("organization_members").select("role").eq("organization_id", orgId).eq("user_id", session.user.id).maybeSingle();
      if (!active) return;
      setRole(entitlement.is_admin ? "owner" : membership?.role ?? "member");
      if (!entitlement.has_access) {
        setEntries([]); setProducts([]); setSuppliers([]); setCommitments([]); setRecipes([]);
        setLoadedOrganizationId(orgId);
        return;
      }
      const [entryResult, productResult, supplierResult, commitmentResult, recipeResult, memberResult] = await Promise.all([
        client.from("financial_entries").select("*").eq("organization_id", orgId).order("occurred_on", { ascending: false }).limit(500),
        client.from("products").select("*").eq("organization_id", orgId).order("name"),
        client.from("suppliers").select("*").eq("organization_id", orgId).order("name"),
        client.from("financial_commitments").select("*").eq("organization_id", orgId).order("due_date"),
        client.from("recipes").select("*, recipe_ingredients(quantity, product:products(name,unit,cost_per_unit))").eq("organization_id", orgId).order("name"),
        client.from("organization_members").select("role").eq("organization_id", orgId).eq("user_id", session.user.id).maybeSingle(),
      ]);
      if (!active) return;
      const failure = [entryResult, productResult, supplierResult, commitmentResult, recipeResult].find((result) => result.error)?.error;
      if (failure) setPageError(failure.message);
      else setPageError("");
      setEntries((entryResult.data ?? []) as Entry[]);
      setProducts((productResult.data ?? []) as Product[]);
      setSuppliers((supplierResult.data ?? []) as Supplier[]);
      setCommitments((commitmentResult.data ?? []) as Commitment[]);
      setRecipes((recipeResult.data ?? []) as Recipe[]);
      setRole(entitlement.is_admin ? "owner" : memberResult.data?.role ?? "member");
      setLoadedOrganizationId(orgId);
    })();
    return () => { active = false; };
  }, [client, session, organization, revision]);

  useEffect(() => {
    if (!client || !session?.user || !organization) return;
    const timer = window.setInterval(() => {
      void client.rpc("get_org_entitlement", { target_organization_id: organization.id }).then(({ data, error }) => {
        if (error || !data) return;
        const nextEntitlement = data as Entitlement;
        setSubscription(nextEntitlement);
        if (!nextEntitlement.has_access) {
          setEntries([]); setProducts([]); setSuppliers([]); setCommitments([]); setRecipes([]);
          setLoadedOrganizationId(organization.id);
        } else if (subscription && !subscription.has_access) {
          setRevision((value) => value + 1);
        }
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [client, session, organization, subscription]);

  useEffect(() => {
    document.querySelector<HTMLElement>(".mobile-nav button.active")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [section]);

  if (!client) return <AuthScreen client={client} />;
  if (authLoading) return <main className="auth-screen"><section className="auth-form-panel"><div className="skeleton" style={{ width: 340 }} /></section></main>;
  if (!session) return <AuthScreen client={client} />;
  if (!today || !selectedMonth) return <main className="auth-screen"><section className="auth-form-panel"><div className="skeleton" style={{ width: 340 }} /></section></main>;

  const loadingData = Boolean(organization && loadedOrganizationId !== organization.id && section !== "companies" && section !== "plans" && section !== "admin");
  const hasAccess = Boolean(subscription?.has_access);
  const accessResolved = Boolean(organization) && loadedOrganizationId === organization?.id;
  const isLocked = (id: Section) => accessResolved && !hasAccess && id !== "companies" && id !== "plans" && id !== "admin";
  const lockedSection = Boolean(organization) && !hasAccess && section !== "companies" && section !== "plans" && !(section === "admin" && isPlatformAdmin);
  const currentMonth = selectedMonth;
  const monthAnchor = new Date(`${currentMonth}-01T12:00:00`);
  const monthEntries = entries.filter((entry) => entry.occurred_on.slice(0, 7) === currentMonth);
  const sales = monthEntries.filter((entry) => entry.kind === "sale").reduce((sum, entry) => sum + Number(entry.amount), 0);
  const expenses = monthEntries.filter((entry) => entry.kind === "expense").reduce((sum, entry) => sum + Number(entry.amount), 0);
  const profit = sales - expenses;
  const margin = sales > 0 ? (profit / sales) * 100 : 0;
  const openPayables = commitments.filter((item) => item.kind === "payable" && item.status === "open");
  const openReceivables = commitments.filter((item) => item.kind === "receivable" && item.status === "open");
  const payableTotal = openPayables.reduce((sum, item) => sum + Number(item.amount), 0);
  const receivableTotal = openReceivables.reduce((sum, item) => sum + Number(item.amount), 0);
  const lowStock = products.filter((product) => Number(product.stock_quantity) <= Number(product.minimum_stock));
  const inventoryValue = products.reduce((sum, product) => sum + Number(product.cost_per_unit) * Number(product.stock_quantity), 0);
  const chartData = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 5 + index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const month = entries.filter((entry) => entry.occurred_on.slice(0, 7) === key);
    return { month: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", ""), vendas: month.filter((entry) => entry.kind === "sale").reduce((sum, entry) => sum + Number(entry.amount), 0), despesas: month.filter((entry) => entry.kind === "expense").reduce((sum, entry) => sum + Number(entry.amount), 0) };
  });
  const hasChartData = chartData.some((item) => item.vendas > 0 || item.despesas > 0);
  const weeklySales = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2024, 0, index + 1);
    const weekday = date.getDay();
    return { day: new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(date).replace(".", ""), total: monthEntries.filter((entry) => entry.kind === "sale" && new Date(`${entry.occurred_on}T12:00:00`).getDay() === weekday).reduce((sum, entry) => sum + Number(entry.amount), 0) };
  });
  const sumByCategory = (kind: Entry["kind"]) => Object.entries(monthEntries.filter((entry) => entry.kind === kind).reduce<Record<string, number>>((totals, entry) => {
    const category = entry.category.trim() || "Sem categoria";
    totals[category] = (totals[category] ?? 0) + Number(entry.amount);
    return totals;
  }, {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const revenueCategories = sumByCategory("sale");
  const expenseCategories = sumByCategory("expense");
  const marginProducts = products.filter((product) => Number(product.sale_price) > 0).map((product) => ({ ...product, margin: (Number(product.sale_price) - Number(product.cost_per_unit)) / Number(product.sale_price) * 100 })).sort((a, b) => b.margin - a.margin).slice(0, 4);
  const chartColors = ["#ff851b", "#09d66a", "#e8ece8", "#78917f", "#d2a13d", "#6e7771"];
  const filteredEntries = entries.filter((entry) => `${entry.description} ${entry.category} ${entry.kind}`.toLowerCase().includes(search.toLowerCase()));
  const filteredProducts = products.filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase()));
  const filteredSuppliers = suppliers.filter((supplier) => `${supplier.name} ${supplier.category ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const filteredCommitments = commitments.filter((item) => `${item.party_name} ${item.description} ${item.kind}`.toLowerCase().includes(search.toLowerCase()));
  const sectionName = navigation.find((item) => item.id === section)?.label ?? "Painel do proprietário";
  const openDialog = (mode: DialogMode) => { if (!hasAccess) return; setPageError(""); setDialog(mode); };

  async function saveRecord(draft: Draft, ingredients: IngredientLine[]) {
    const db = client;
    const user = session?.user;
    if (!db || !organization || !user) throw new Error("Selecione uma empresa antes de salvar.");
    const orgId = organization.id;
    let result: { error: { message: string } | null };
    if (dialog === "sale" || dialog === "expense") {
      result = await db.from("financial_entries").insert({ organization_id: orgId, kind: dialog, description: draft.description, category: draft.category, amount: Number(draft.amount), occurred_on: draft.occurred_on, payment_method: draft.payment_method || null, created_by: user.id });
    } else if (dialog === "payable" || dialog === "receivable") {
      result = await db.from("financial_commitments").insert({ organization_id: orgId, kind: dialog, party_name: draft.party_name, description: draft.description, amount: Number(draft.amount), due_date: draft.due_date, status: "open", created_by: user.id });
    } else if (dialog === "product") {
      result = await db.from("products").insert({ organization_id: orgId, name: draft.name, category: draft.category || null, unit: draft.unit, cost_per_unit: Number(draft.cost_per_unit), sale_price: Number(draft.sale_price), stock_quantity: Number(draft.stock_quantity), minimum_stock: Number(draft.minimum_stock) });
    } else if (dialog === "supplier") {
      result = await db.from("suppliers").insert({ organization_id: orgId, name: draft.name, contact_name: draft.contact_name || null, category: draft.category || null, email: draft.email || null, phone: draft.phone || null });
    } else if (dialog === "recipe") {
      const { data: recipe, error: recipeError } = await db.from("recipes").insert({ organization_id: orgId, name: draft.name, selling_price: Number(draft.selling_price) }).select("id").single();
      if (recipeError) throw recipeError;
      const ingredientResult = await db.from("recipe_ingredients").insert(ingredients.filter((line) => line.product_id).map((line) => ({ recipe_id: recipe.id, product_id: line.product_id, quantity: Number(line.quantity) })));
      if (ingredientResult.error) {
        await db.from("recipes").delete().eq("id", recipe.id).eq("organization_id", orgId);
        throw ingredientResult.error;
      }
      setRevision((value) => value + 1);
      return;
    } else {
      throw new Error("Ação desconhecida.");
    }
    if (result.error) throw result.error;
    setRevision((value) => value + 1);
  }

  async function removeRecord(table: string, id: string) {
    if (!window.confirm("Excluir este registro? Esta ação não pode ser desfeita.")) return;
    const db = client;
    if (!db) return;
    await runMutation(id, async () => await db.from(table).delete().eq("id", id).eq("organization_id", organization?.id ?? ""));
  }

  async function runMutation(id: string, operation: () => Promise<{ error: { message: string } | null }>) {
    setBusyId(id);
    setPageError("");
    try {
      const { error } = await operation();
      if (error) throw error;
      setRevision((value) => value + 1);
    } catch (error) {
      setPageError(errorText(error));
    } finally {
      setBusyId("");
    }
  }

  async function markCommitment(item: Commitment) {
    const db = client;
    if (!db) return;
    await runMutation(item.id, async () => await db.from("financial_commitments").update({ status: item.status === "paid" ? "open" : "paid", paid_at: item.status === "paid" ? null : new Date().toISOString() }).eq("id", item.id).eq("organization_id", organization?.id ?? ""));
  }

  async function adjustStock(product: Product, change: number) {
    const nextQuantity = Number(product.stock_quantity) + change;
    if (nextQuantity < 0) return;
    const db = client;
    if (!db) return;
    await runMutation(product.id, async () => await db.from("products").update({ stock_quantity: nextQuantity }).eq("id", product.id).eq("organization_id", organization?.id ?? ""));
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    const db = client;
    if (!db) {
      setPageError("Conexão com o banco indisponível. Verifique as variáveis do Supabase.");
      return;
    }
    if (!session?.user) {
      setPageError("Sessão expirada. Entre novamente para criar uma empresa.");
      return;
    }
    const form = event.currentTarget;
    const name = String(new FormData(form).get("organization_name") ?? "").trim();
    if (!name) {
      setPageError("Informe o nome da empresa.");
      return;
    }
    if (name.length > 120) {
      setPageError("O nome da empresa deve ter no máximo 120 caracteres.");
      return;
    }
    const duplicate = organizations.some((item) => item.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      setPageError("Já existe uma empresa com este nome na sua conta.");
      return;
    }
    setBusyId("create-organization");
    setPageError("");
    try {
      const { data, error } = await db.rpc("create_organization", { organization_name: name });
      if (error) {
        const msg = error.message || "";
        if (/permission|not authorized|42501/i.test(msg)) {
          throw new Error("Sem permissão para criar empresa. Confirme se a migration create_organization foi aplicada no Supabase.");
        }
        if (/could not find the function|PGRST202|404/i.test(msg)) {
          throw new Error("Função create_organization não encontrada no banco. Aplique as migrations em supabase/migrations no seu projeto Supabase.");
        }
        throw error;
      }
      if (!data) throw new Error("A empresa não foi criada. Tente novamente.");
      // Recarrega a lista do banco para garantir persistência
      const { data: companyList, error: listError } = await db.from("organizations").select("id,name,created_at").order("created_at", { ascending: true });
      if (listError) throw listError;
      const list = (companyList ?? []) as Organization[];
      const created = list.find((item) => item.id === data) ?? { id: String(data), name, created_at: new Date().toISOString() };
      setOrganizations(list.length ? list : [...organizations, created]);
      setOrganization(created);
      setLoadedOrganizationId(null);
      form.reset();
      setRevision((value) => value + 1);
      setSection("dashboard");
    } catch (error) {
      setPageError(errorText(error));
    } finally {
      setBusyId("");
    }
  }

  async function renameOrganization(company: Organization) {
    const db = client;
    if (!db) return;
    const nextName = window.prompt("Novo nome da empresa", company.name)?.trim();
    if (!nextName || nextName === company.name) return;
    if (nextName.length < 1 || nextName.length > 120) {
      setPageError("O nome da empresa deve ter entre 1 e 120 caracteres.");
      return;
    }
    const duplicate = organizations.some((item) => item.id !== company.id && item.name.trim().toLowerCase() === nextName.toLowerCase());
    if (duplicate) {
      setPageError("Já existe uma empresa com este nome na sua conta.");
      return;
    }
    setBusyId(company.id);
    setPageError("");
    try {
      const { error } = await db.from("organizations").update({ name: nextName }).eq("id", company.id);
      if (error) throw error;
      setOrganizations((current) => current.map((item) => item.id === company.id ? { ...item, name: nextName } : item));
      setOrganization((current) => current?.id === company.id ? { ...current, name: nextName } : current);
    } catch (error) {
      setPageError(errorText(error));
    } finally {
      setBusyId("");
    }
  }

  async function deleteOrganization(company: Organization) {
    const db = client;
    if (!db) return;
    if (organizations.length <= 1) {
      setPageError("Não é possível excluir a única empresa da conta. Crie outra antes de remover esta.");
      return;
    }
    const confirmed = window.confirm(`Excluir a empresa "${company.name}"? Todos os dados financeiros, produtos e fichas desta empresa serão removidos permanentemente.`);
    if (!confirmed) return;
    setBusyId(company.id);
    setPageError("");
    try {
      const { error } = await db.from("organizations").delete().eq("id", company.id);
      if (error) throw error;
      const remaining = organizations.filter((item) => item.id !== company.id);
      setOrganizations(remaining);
      if (organization?.id === company.id) {
        setOrganization(remaining[0] ?? null);
        setRevision((value) => value + 1);
      }
    } catch (error) {
      setPageError(errorText(error));
    } finally {
      setBusyId("");
    }
  }

  function exportCsv() {
    const rows = [["Data", "Tipo", "Descrição", "Categoria", "Forma de pagamento", "Valor (BRL)"], ...filteredEntries.map((entry) => [entry.occurred_on, entry.kind === "sale" ? "Venda" : "Despesa", entry.description, entry.category, entry.payment_method ?? "", String(entry.amount)])];
    const csv = rows.map((row) => row.map((field) => `"${field.replaceAll('"', '""')}"`).join(";")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    link.download = `foodfinance-${organization?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "relatorio"}-${currentMonth}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const transactionsTable = (rows: Entry[]) => rows.length ? <div className="table-wrap"><table><thead><tr><th>Movimentação</th><th>Categoria</th><th>Data</th><th>Valor</th><th></th></tr></thead><tbody>{rows.map((entry) => <tr key={entry.id}><td><div className="table-primary">{entry.description}</div><div className="table-secondary">{entry.kind === "sale" ? "Venda" : "Despesa"}{entry.payment_method ? ` · ${entry.payment_method}` : ""}</div></td><td><span className="category-pill">{entry.category}</span></td><td>{dateFormat.format(new Date(`${entry.occurred_on}T12:00:00`))}</td><td className={`amount ${entry.kind === "sale" ? "positive" : "negative"}`}>{entry.kind === "sale" ? "+" : "−"}{currency.format(Number(entry.amount))}</td><td><button className="icon-button" aria-label="Excluir movimentação" disabled={busyId === entry.id} onClick={() => void removeRecord("financial_entries", entry.id)}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={ReceiptText} title="Sem movimentações" description="Registre vendas e despesas para começar a acompanhar o resultado." />;

  const pageActions = section === "dashboard" ? <button className="button button-primary" onClick={() => openDialog("sale")}><Plus size={15} /> Registrar venda</button>
    : section === "transactions" ? <div className="topbar-actions"><button className="button button-secondary" onClick={() => openDialog("expense")}><ArrowDownRight size={14} /> Nova despesa</button><button className="button button-primary" onClick={() => openDialog("sale")}><Plus size={15} /> Nova venda</button></div>
    : section === "commitments" ? <div className="topbar-actions"><button className="button button-secondary" onClick={() => openDialog("receivable")}><ArrowDownLeft size={14} /> A receber</button><button className="button button-primary" onClick={() => openDialog("payable")}><Plus size={15} /> A pagar</button></div>
    : section === "products" ? <button className="button button-primary" onClick={() => openDialog("product")}><Plus size={15} /> Novo produto</button>
    : section === "recipes" ? <button className="button button-primary" onClick={() => openDialog("recipe")}><Plus size={15} /> Nova ficha</button>
    : section === "suppliers" ? <button className="button button-primary" onClick={() => openDialog("supplier")}><Plus size={15} /> Novo fornecedor</button>
    : section === "reports" ? <button className="button button-secondary" onClick={exportCsv}><Download size={15} /> Exportar CSV</button>
    : null;

  const insightItems = [
    ...(sales === 0 && expenses === 0 ? [{ title: "Comece pelo registro diário", text: "Adicione vendas e despesas do período para gerar uma leitura financeira baseada nos seus dados.", icon: Lightbulb }] : []),
    ...(sales > 0 ? [{ title: profit >= 0 ? "Resultado operacional positivo" : "Despesas acima das vendas", text: profit >= 0 ? `O resultado registrado neste mês é ${currency.format(profit)}, com margem de ${margin.toFixed(1).replace(".", ",")}% sobre as vendas.` : `O resultado registrado está em ${currency.format(profit)}. Revise as despesas e confirme se todos os recebimentos foram lançados.`, icon: profit >= 0 ? TrendingUp : TrendingDown }] : []),
    ...(lowStock.length ? [{ title: `${lowStock.length} item(ns) no limite de estoque`, text: `Confira ${lowStock.slice(0, 3).map((product) => product.name).join(", ")}${lowStock.length > 3 ? " e outros" : ""} para evitar ruptura na operação.`, icon: AlertTriangle }] : []),
    ...(payableTotal > 0 ? [{ title: "Compromissos em aberto", text: `${currency.format(payableTotal)} a pagar e ${currency.format(receivableTotal)} a receber. O saldo líquido previsto é ${currency.format(receivableTotal - payableTotal)}.`, icon: Wallet }] : []),
    ...(recipes.length ? [{ title: "Margem das fichas técnicas", text: `Há ${recipes.length} ficha(s) técnica(s) cadastrada(s). Revise custos e preços sempre que o valor de compra dos insumos mudar.`, icon: ShoppingBasket }] : []),
  ];

  return <div className="app-frame">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><ChefHat size={20} /><span className="brand-trend"><TrendingUp size={11} /></span></div><div><div className="brand-name">Food<span>Finance</span></div><div className="brand-tag">Gestão que dá lucro</div></div></div>
      <button className="workspace-switch" onClick={() => setOrgMenuOpen((open) => !open)} aria-expanded={orgMenuOpen}><span><span className="workspace-label">EMPRESA ATIVA</span><span className="workspace-name">{organization?.name ?? "Selecione uma empresa"}</span></span><ChevronDown size={15} /></button>
      {orgMenuOpen && <div className="company-list" style={{ marginTop: 7 }}>{organizations.map((company) => <button className={`company-option ${company.id === organization?.id ? "selected" : ""}`} key={company.id} onClick={() => { setOrganization(company); setOrgMenuOpen(false); setPageError(""); setLoadedOrganizationId(null); }}><span style={{ fontSize: 11 }}>{company.name}</span>{company.id === organization?.id && <Check size={14} />}</button>)}<button className="button button-secondary" style={{ width: "100%", marginTop: 4 }} onClick={() => { setSection("companies"); setOrgMenuOpen(false); }}><Plus size={14} /> Nova empresa</button></div>}
      {(["GESTÃO", "CARDÁPIO", "ANÁLISES", "CONTA"] as const).map((group) => <div className="nav-group" key={group}><div className="nav-label">{group}</div>{navigation.filter((item) => item.group === group).map(({ id, label, hint, icon }) => <NavLinkButton key={id} label={label} hint={hint} icon={icon} active={section === id} locked={isLocked(id)} onSelect={() => { setSection(id); setSearch(""); }} />)}</div>)}
      {isPlatformAdmin && <div className="nav-group"><div className="nav-label">PROPRIETÁRIO</div><NavLinkButton label="Painel administrativo" hint="Métricas gerais da plataforma: empresas, assinaturas e contas em avaliação." icon={Settings2} active={section === "admin"} locked={false} onSelect={() => setSection("admin")} /></div>}
      <div className="sidebar-bottom">
        {organization && <button className="sidebar-plan" onClick={() => setSection("plans")}><span className="sidebar-plan-icon"><CreditCard size={16} /></span><strong>{subscription?.plan_key ? (subscription.plan_key === "bronze" || subscription.plan_key === "essencial" ? "Plano Bronze" : `Plano ${subscription.plan_key}`) : "Plano Bronze"}</strong><small>{accessLabel(subscription)}</small><span className="sidebar-plan-action">Gerenciar assinatura</span></button>}
        <div className="user-card"><div className="avatar">{session.user.email?.slice(0, 1).toUpperCase() ?? "U"}</div><div className="user-meta"><div className="user-email">{session.user.email}</div><div className="role-tag">{role === "owner" ? "Proprietário" : role === "manager" ? "Gerente" : "Equipe"}</div></div><button className="icon-button" aria-label="Sair" title="Sair" onClick={() => void client.auth.signOut()}><LogOut size={15} /></button></div>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><span className="topbar-title">{sectionName}</span></div><div className="topbar-actions"><label className="sr-only" htmlFor="month-filter">Mês do relatório</label><input id="month-filter" className="month-picker" type="month" value={currentMonth} onChange={(event) => setSelectedMonth(event.target.value)} /><span className={`status ${pageError ? "status-danger" : ""}`}><span className="legend-dot" style={{ background: pageError ? "var(--red)" : "var(--green)", margin: 0 }} />{pageError ? "Falha na sincronização" : loadingData ? "Sincronizando" : "Dados sincronizados"}</span><div className="avatar">{session.user.email?.slice(0, 1).toUpperCase() ?? "U"}</div><button className="icon-button mobile-only" aria-label="Sair" title="Sair" onClick={() => void client.auth.signOut()}><LogOut size={15} /></button></div></header>
      <div className="content">
        {pageError && <div className="error-message" role="alert" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 10 }}>{pageError}<button className="text-button" onClick={() => setPageError("")} aria-label="Fechar aviso"><X size={14} /></button></div>}
        <div className="page-heading"><div><div className="eyebrow">{organization?.name ?? "FoodFinance"}</div><h1 className="page-title">{section === "dashboard" ? `Olá, ${organization?.name ?? "seu negócio"}` : sectionName}</h1><p className="page-subtitle">{section === "dashboard" ? "Aqui está um resumo da sua performance financeira." : (navigation.find((item) => item.id === section)?.hint ?? "Consulte e mantenha os registros financeiros da empresa.")}</p></div>{lockedSection ? null : pageActions}</div>

        {loadingData ? <div className="metric-grid"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : (!organization || section === "companies") ? (
          section !== "companies" && !organization ? <section className="panel"><EmptyState icon={Store} title="Nenhuma empresa vinculada" description="Crie uma empresa para começar. Os dados ficarão isolados por organização." action={<button className="button button-primary" onClick={() => setSection("companies")}><Plus size={14} /> Criar empresa</button>} /></section>
          : <div className="dashboard-grid"><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Empresas vinculadas</h2><p className="panel-description">Cada empresa possui dados isolados pelas políticas do banco. Apenas o proprietário pode editar ou excluir.</p></div><span className="category-pill">{organizations.length} empresa(s)</span></div><div className="section-toolbar" style={{ marginBottom: 12 }}><div className="field search-input" style={{ flex: 1 }}><label className="sr-only" htmlFor="company-search">Buscar empresas</label><div style={{ position: "relative" }}><Search size={14} style={{ position: "absolute", top: 12, left: 11, color: "#778078" }} /><input id="company-search" className="input" style={{ paddingLeft: 33 }} placeholder="Buscar por nome da empresa" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div></div><div className="company-list">{organizations.filter((company) => company.name.toLowerCase().includes(search.toLowerCase())).map((company) => <div key={company.id} className={`company-option ${company.id === organization?.id ? "selected" : ""}`} style={{ cursor: "default" }}><button type="button" style={{ all: "unset", cursor: "pointer", flex: 1, minWidth: 0 }} onClick={() => { setOrganization(company); setPageError(""); setLoadedOrganizationId(null); }}><span>{company.name}<small>Criada em {dateFormat.format(new Date(company.created_at))}{company.id === organization?.id ? " · ativa" : ""}</small></span></button><div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>{company.id === organization?.id && <CheckCircle2 size={16} className="positive" />}<button type="button" className="icon-button" aria-label={`Renomear ${company.name}`} disabled={busyId === company.id || role !== "owner"} onClick={() => void renameOrganization(company)} title={role !== "owner" ? "Apenas o proprietário pode editar" : "Renomear"}><Pencil size={13} /></button><button type="button" className="icon-button" aria-label={`Excluir ${company.name}`} disabled={busyId === company.id || role !== "owner" || organizations.length <= 1} onClick={() => void deleteOrganization(company)} title={organizations.length <= 1 ? "Crie outra empresa antes de excluir esta" : role !== "owner" ? "Apenas o proprietário pode excluir" : "Excluir"}><Trash2 size={13} /></button></div></div>)}{organizations.filter((company) => company.name.toLowerCase().includes(search.toLowerCase())).length === 0 && <EmptyState icon={Store} title="Nenhuma empresa encontrada" description={search ? "Ajuste o termo de busca ou cadastre uma nova empresa." : "Crie a primeira empresa para começar."} />}</div></section><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Adicionar empresa</h2><p className="panel-description">Crie um novo espaço de trabalho com isolamento independente. Os recursos de cada empresa dependem da assinatura ativa da conta.</p></div></div><form className="auth-fields" onSubmit={(event) => void createOrganization(event)}><div className="field"><label htmlFor="organization-name">Nome da empresa</label><input id="organization-name" name="organization_name" className="input" maxLength={120} placeholder="Ex.: Unidade Centro" required disabled={busyId === "create-organization"} /></div><button className="button button-primary" type="submit" disabled={busyId === "create-organization"}>{busyId === "create-organization" ? "Criando..." : <><Plus size={14} /> Criar empresa</>}</button></form></section></div>
        )
        : section === "plans" ? (
          <div className="dashboard-grid">
            <section className="panel">
              <div className="panel-header"><div><h2 className="panel-title">Assinatura</h2><p className="panel-description">Status atual da sua conta FoodFinance.</p></div><span className="status">{accessLabel(subscription)}</span></div>
              <div className="metric-top"><span>Plano</span><strong>Plano Bronze</strong></div>
              <div className="metric-note">{subscription?.trial_ends_at ? `Avaliação até ${dateFormat.format(new Date(`${subscription.trial_ends_at}T12:00:00`))}` : subscription?.access_until ? `Acesso até ${dateFormat.format(new Date(subscription.access_until))}` : "Assine o Plano Bronze para liberar o acesso completo."}</div>
              <a className="button button-primary" style={{ marginTop: 18 }} href={checkoutUrl} target="_blank" rel="noopener noreferrer">Assinar Plano Bronze na Kiwify <ArrowUpRight size={14} /></a>
              <div className="notice" style={{ marginTop: 15 }}>Você será redirecionado para a página de pagamento da Kiwify. Após a confirmação do pagamento, o acesso ao FoodFinance é liberado automaticamente.</div>
            </section>
            <section className="panel">
              <div className="panel-header"><div><h2 className="panel-title">Plano Bronze</h2><p className="panel-description">Acesso completo à gestão financeira do FoodFinance.</p></div>{(subscription?.plan_key === "bronze" || subscription?.plan_key === "essencial") && subscription?.status === "active" ? <CheckCircle2 size={18} className="positive" /> : null}</div>
              <div className="company-list">
                <a className={`company-option ${(subscription?.plan_key === "bronze" || subscription?.plan_key === "essencial") && subscription?.has_access ? "selected" : ""}`} href={checkoutUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                  <span>Plano Bronze<small>Financeiro, contas, estoque, fichas técnicas, fornecedores e relatórios</small></span>
                  <ArrowUpRight size={15} />
                </a>
              </div>
              <a className="button button-primary" style={{ marginTop: 16, width: "100%" }} href={checkoutUrl} target="_blank" rel="noopener noreferrer">Ir para o checkout Kiwify <ArrowUpRight size={14} /></a>
            </section>
          </div>
        )
        : section === "admin" && isPlatformAdmin ? (
          <section className="panel"><div className="panel-header"><div><h2 className="panel-title">Painel do proprietário</h2><p className="panel-description">Métricas agregadas da plataforma, sem expor dados financeiros de clientes.</p></div></div><AdminOverview client={client} /></section>
        )
        : !hasAccess ? <section className="panel paywall-panel"><span className="paywall-icon"><Lock size={22} /></span><div className="eyebrow">Recurso bloqueado</div><h2 className="panel-title">Disponível somente com assinatura do plano</h2><p className="panel-description">Você está conectado e pode gerenciar sua conta, suas empresas e sua assinatura. Porém, <strong>{sectionName}</strong> e os demais recursos do FoodFinance ficam liberados somente para quem tem o Plano Bronze ativo. O acesso é liberado automaticamente após a confirmação do pagamento pela Kiwify.</p><ul className="setup-list"><li><Check size={14} /> Vendas, despesas e contas a pagar e receber</li><li><Check size={14} /> Produtos, estoque, fichas técnicas e fornecedores</li><li><Check size={14} /> Dashboard, relatórios e análises</li></ul><div className="paywall-status"><span>Situação</span><strong>{accessLabel(subscription)}</strong>{subscription?.trial_ends_at && <span>Avaliação até {dateFormat.format(new Date(`${subscription.trial_ends_at}T12:00:00`))}</span>}</div><div className="topbar-actions" style={{ flexWrap: "wrap" }}><a className="button button-primary" href={checkoutUrl} target="_blank" rel="noopener noreferrer">Assinar Plano Bronze na Kiwify <ArrowUpRight size={15} /></a><button className="button button-secondary" onClick={() => setSection("plans")}>Ver minha assinatura</button></div></section>
        : <>
          {section === "dashboard" && <>
            <div className="metric-grid">
              <Metric icon={TrendingUp} label="Faturamento" value={currency.format(sales)} note={`${monthEntries.filter((item) => item.kind === "sale").length} lançamento(s) no mês`} tone="positive" hint="Soma de todas as vendas registradas no mês selecionado." />
              <Metric icon={ArrowUpRight} label="Despesas" value={currency.format(expenses)} note={`${monthEntries.filter((item) => item.kind === "expense").length} lançamento(s) no mês`} tone="negative" hint="Soma de tudo o que foi gasto no mês: insumos, aluguel, folha, contas e outras despesas lançadas." />
              <Metric icon={Wallet} label="Lucro líquido" value={currency.format(profit)} note={sales ? `Margem registrada de ${margin.toFixed(1).replace(".", ",")}%` : "Aguardando lançamentos reais"} tone={profit >= 0 ? "positive" : "negative"} hint="O que sobrou no mês: faturamento menos despesas. A margem é o lucro dividido pelo faturamento." />
              <Metric icon={ReceiptText} label="Vendas" value={String(monthEntries.filter((item) => item.kind === "sale").length)} note="Registros de venda neste mês" hint="Quantidade de lançamentos de venda no mês (não é o valor, é quantas vendas foram registradas)." />
            </div>
            <div className="dashboard-grid dashboard-grid-primary">
              <section className="panel"><div className="panel-header"><div><PanelTitle title="Vendas por dia da semana" hint="Mostra em quais dias da semana você mais vende, somando as vendas do mês por dia. Ajuda a planejar equipe e estoque." /><p className="panel-description">Distribuição das vendas registradas no mês</p></div><span className="chart-legend"><i className="legend-dot" style={{ background: "var(--orange)" }} />Vendas</span></div>
                {weeklySales.some((item) => item.total > 0) ? <div className="chart-wrap chart-wrap-week"><ResponsiveContainer width="100%" height="100%"><BarChart data={weeklySales} margin={{ top: 8, right: 5, left: -18, bottom: 0 }}><CartesianGrid stroke="#292d31" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#969ba1", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#858b91", fontSize: 9 }} tickFormatter={(value: number) => value >= 1000 ? `R$ ${(value / 1000).toFixed(0)}k` : `R$ ${value}`} /><Tooltip formatter={(value) => currency.format(Number(value ?? 0))} contentStyle={{ background: "#181a1d", border: "1px solid #363a3e", borderRadius: 7, color: "#f2f2f2", fontSize: 11 }} /><Bar dataKey="total" name="Faturamento" fill="#ff851b" radius={[5, 5, 0, 0]} maxBarSize={38} /></BarChart></ResponsiveContainer></div> : <div className="empty-chart">Sem vendas registradas nesta semana.<br />As barras serão formadas pelos seus lançamentos.</div>}
              </section>
              <section className="panel"><div className="panel-header"><div><PanelTitle title="Distribuição de receitas" hint="Mostra de onde vem o faturamento: cada fatia é uma categoria de venda (balcão, delivery...) e o percentual é a parte dela no total do mês." /><p className="panel-description">Categorias de venda neste mês</p></div></div>
                {revenueCategories.length ? <div className="donut-layout"><div className="donut-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={revenueCategories} dataKey="value" nameKey="name" innerRadius="63%" outerRadius="88%" paddingAngle={2} stroke="none">{revenueCategories.map((item, index) => <Cell key={item.name} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip formatter={(value) => currency.format(Number(value ?? 0))} contentStyle={{ background: "#181a1d", border: "1px solid #363a3e", borderRadius: 7, color: "#f2f2f2", fontSize: 11 }} /></PieChart></ResponsiveContainer><div className="donut-total"><strong>{currency.format(sales)}</strong><span>no mês</span></div></div><div className="category-legend">{revenueCategories.map((item, index) => <LegendRow key={item.name} kind="receitas" name={item.name} value={item.value} total={sales} color={chartColors[index % chartColors.length]} />)}</div></div> : <EmptyState icon={ReceiptText} title="Sem receita categorizada" description="Registre vendas com categorias para comparar os canais." />}
              </section>
            </div>
            <div className="dashboard-grid dashboard-grid-lower">
              <section className="panel"><div className="panel-header"><div><PanelTitle title="Melhores margens" hint="Ranking dos produtos com maior margem bruta: (preço − custo) ÷ preço. Quanto maior, mais sobra de cada venda." /><p className="panel-description">Preço e custo cadastrados por produto</p></div><button className="button button-quiet" onClick={() => setSection("products")}>Ver estoque <ArrowUpRight size={13} /></button></div>{marginProducts.length ? <div className="ranked-list">{marginProducts.map((product) => <div className="ranked-row" key={product.id}><span className="ranked-icon"><ShoppingBasket size={15} /></span><span className="ranked-name"><strong>{product.name}</strong><small>{currency.format(Number(product.sale_price))} por unidade</small></span><strong className={product.margin >= 0 ? "positive" : "negative"}>{product.margin.toFixed(1).replace(".", ",")}%</strong></div>)}</div> : <EmptyState icon={Package} title="Sem produtos precificados" description="Cadastre custo e preço para comparar margens." />}</section>
              <section className="panel"><div className="panel-header"><div><PanelTitle title="Despesas por categoria" hint="Mostra para onde vai o dinheiro: cada fatia é uma categoria de despesa e o percentual é a parte dela no total gasto no mês." /><p className="panel-description">Composição dos gastos neste mês</p></div></div>{expenseCategories.length ? <div className="donut-layout"><div className="donut-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={expenseCategories} dataKey="value" nameKey="name" innerRadius="63%" outerRadius="88%" paddingAngle={2} stroke="none">{expenseCategories.map((item, index) => <Cell key={item.name} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip formatter={(value) => currency.format(Number(value ?? 0))} contentStyle={{ background: "#181a1d", border: "1px solid #363a3e", borderRadius: 7, color: "#f2f2f2", fontSize: 11 }} /></PieChart></ResponsiveContainer><div className="donut-total"><strong>{currency.format(expenses)}</strong><span>no mês</span></div></div><div className="category-legend">{expenseCategories.map((item, index) => <LegendRow key={item.name} kind="despesas" name={item.name} value={item.value} total={expenses} color={chartColors[index % chartColors.length]} />)}</div></div> : <EmptyState icon={ArrowUpRight} title="Sem despesas categorizadas" description="Registre despesas para visualizar sua composição." />}</section>
              <div className="dashboard-stack">
                <Tip text="Resumo rápido da saúde financeira do mês: fica verde quando as vendas superam as despesas." className={`health-banner ${sales > 0 && profit >= 0 ? "health-good" : "health-neutral"}`}><span className="health-icon">{sales > 0 && profit >= 0 ? <CheckCircle2 size={18} /> : <CircleHelp size={18} />}</span><span><strong>{sales > 0 && profit >= 0 ? "Resultado positivo" : "Acompanhe seu resultado"}</strong><small>{sales > 0 ? `Margem de ${margin.toFixed(1).replace(".", ",")}% registrada no mês.` : "Registre vendas e despesas para calcular a margem."}</small></span><TrendingUp className="health-trend" size={27} /></Tip>
                <section className="panel quick-panel"><div className="panel-header"><div><PanelTitle title="Ações rápidas" hint="Atalhos para a rotina do dia a dia: lançar venda, lançar despesa e ajustar o estoque." /><p className="panel-description">Atalhos para a rotina</p></div></div><div className="quick-actions"><button className="quick-action" onClick={() => openDialog("sale")}><span className="quick-icon quick-green"><TrendingUp size={17} /></span><span>Registrar venda</span></button><button className="quick-action" onClick={() => openDialog("expense")}><span className="quick-icon quick-orange"><ArrowDownRight size={17} /></span><span>Adicionar despesa</span></button><button className="quick-action" onClick={() => setSection("products")}><span className="quick-icon quick-amber"><Package size={17} /></span><span>Atualizar estoque</span></button></div></section>
              </div>
            </div>
            <section className="panel activity-panel"><div className="panel-header"><div><PanelTitle title="Atividade recente" hint="As 5 últimas movimentações financeiras lançadas, entre vendas e despesas." /><p className="panel-description">Últimas movimentações financeiras</p></div><button className="button button-quiet" onClick={() => setSection("transactions")}>Todas as movimentações <ArrowUpRight size={13} /></button></div>{transactionsTable(entries.slice(0, 5))}</section>
          </>}

          {section === "transactions" && <section className="panel"><div className="section-toolbar"><div className="field search-input"><label className="sr-only" htmlFor="entry-search">Buscar movimentações</label><div style={{ position: "relative" }}><Search size={14} style={{ position: "absolute", top: 12, left: 11, color: "#778078" }} /><input id="entry-search" className="input" style={{ paddingLeft: 33 }} placeholder="Buscar descrição ou categoria" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div><span className="panel-description">{filteredEntries.length} registro(s)</span></div>{transactionsTable(filteredEntries)}</section>}

          {section === "commitments" && <section className="panel"><div className="section-toolbar"><div className="field search-input"><label className="sr-only" htmlFor="commitment-search">Buscar contas</label><div style={{ position: "relative" }}><Search size={14} style={{ position: "absolute", top: 12, left: 11, color: "#778078" }} /><input id="commitment-search" className="input" style={{ paddingLeft: 33 }} placeholder="Buscar conta ou favorecido" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div><span className="panel-description">Em aberto: {currency.format(payableTotal - receivableTotal)}</span></div>{filteredCommitments.length ? <div className="table-wrap"><table><thead><tr><th>Conta</th><th>Tipo</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead><tbody>{filteredCommitments.map((item) => <tr key={item.id}><td><div className="table-primary">{item.description}</div><div className="table-secondary">{item.party_name}</div></td><td>{item.kind === "payable" ? "A pagar" : "A receber"}</td><td>{dateFormat.format(new Date(`${item.due_date}T12:00:00`))}</td><td className="amount">{currency.format(Number(item.amount))}</td><td><span className={`status ${item.status === "paid" ? "" : new Date(`${item.due_date}T23:59:59`) < today ? "status-danger" : "status-warning"}`}>{item.status === "paid" ? "Liquidada" : new Date(`${item.due_date}T23:59:59`) < today ? "Vencida" : "Em aberto"}</span></td><td><div style={{ display: "flex", gap: 5 }}><button className="button button-secondary" style={{ minHeight: 29, padding: "0 8px", fontSize: 10 }} disabled={busyId === item.id} onClick={() => void markCommitment(item)}>{item.status === "paid" ? "Reabrir" : "Liquidar"}</button><button className="icon-button" aria-label="Excluir conta" disabled={busyId === item.id} onClick={() => void removeRecord("financial_commitments", item.id)}><Trash2 size={13} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={CalendarDays} title="Nenhuma conta cadastrada" description="Registre compromissos futuros para visualizar vencimentos e fluxo previsto." />}</section>}

          {section === "products" && <section className="panel"><div className="section-toolbar"><div className="field search-input"><label className="sr-only" htmlFor="product-search">Buscar produtos</label><div style={{ position: "relative" }}><Search size={14} style={{ position: "absolute", top: 12, left: 11, color: "#778078" }} /><input id="product-search" className="input" style={{ paddingLeft: 33 }} placeholder="Buscar produto ou categoria" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div><span className="panel-description">Estoque a custo: {currency.format(inventoryValue)}</span></div>{filteredProducts.length ? <div className="table-wrap"><table><thead><tr><th>Produto</th><th>Custo / un. <Hint text="Quanto você paga por unidade do produto ou insumo." /></th><th>Preço</th><th>Margem bruta <Hint text="Quanto sobra do preço depois de descontar o custo, em porcentagem." /></th><th>Estoque <Hint text="Quantidade disponível agora. Fica em alerta quando chega ao mínimo definido." /></th><th>Ajuste</th><th></th></tr></thead><tbody>{filteredProducts.map((product) => { const unitMargin = Number(product.sale_price) > 0 ? ((Number(product.sale_price) - Number(product.cost_per_unit)) / Number(product.sale_price)) * 100 : 0; const below = Number(product.stock_quantity) <= Number(product.minimum_stock); return <tr key={product.id}><td><div className="table-primary">{product.name}</div><div className="table-secondary">{product.category || "Sem categoria"} · {product.unit}</div></td><td>{currency.format(Number(product.cost_per_unit))}</td><td>{currency.format(Number(product.sale_price))}</td><td className={unitMargin >= 0 ? "positive" : "negative"}>{unitMargin.toFixed(1).replace(".", ",")}%</td><td><span className={`status ${below ? "status-warning" : ""}`}>{Number(product.stock_quantity)} {product.unit}{below && <AlertTriangle size={11} />}</span></td><td><div style={{ display: "flex", gap: 4 }}><button className="icon-button" aria-label={`Diminuir estoque de ${product.name}`} disabled={busyId === product.id || Number(product.stock_quantity) <= 0} onClick={() => void adjustStock(product, -1)}><span aria-hidden="true">−</span></button><button className="icon-button" aria-label={`Adicionar estoque a ${product.name}`} disabled={busyId === product.id} onClick={() => void adjustStock(product, 1)}><Plus size={13} /></button></div></td><td><button className="icon-button" aria-label={`Excluir ${product.name}`} disabled={busyId === product.id} onClick={() => void removeRecord("products", product.id)}><Trash2 size={13} /></button></td></tr>; })}</tbody></table></div> : <EmptyState icon={Package} title="Seu estoque começa aqui" description="Cadastre produtos, custos e níveis mínimos para acompanhar reposição e margem." />}</section>}

          {section === "recipes" && <section className="panel">{recipes.length ? <div className="table-wrap"><table><thead><tr><th>Ficha técnica</th><th>Insumos</th><th>Custo total <Hint text="Soma do custo de todos os ingredientes da ficha técnica." /></th><th>Preço de venda</th><th>Margem bruta <Hint text="Quanto sobra do preço depois de descontar o custo, em porcentagem." /></th><th></th></tr></thead><tbody>{recipes.map((recipe) => { const cost = (recipe.recipe_ingredients ?? []).reduce((sum, ingredient) => sum + Number(ingredient.quantity) * Number(ingredient.product?.cost_per_unit ?? 0), 0); const grossProfit = Number(recipe.selling_price) - cost; const grossMargin = Number(recipe.selling_price) > 0 ? grossProfit / Number(recipe.selling_price) * 100 : 0; return <tr key={recipe.id}><td><div className="table-primary">{recipe.name}</div></td><td>{(recipe.recipe_ingredients ?? []).length} ingrediente(s)</td><td>{currency.format(cost)}</td><td>{currency.format(Number(recipe.selling_price))}</td><td className={grossMargin >= 0 ? "positive" : "negative"}>{grossMargin.toFixed(1).replace(".", ",")}% <div className="table-secondary">{currency.format(grossProfit)} / unidade</div></td><td><button className="icon-button" aria-label={`Excluir ficha ${recipe.name}`} disabled={busyId === recipe.id} onClick={() => void removeRecord("recipes", recipe.id)}><Trash2 size={13} /></button></td></tr>; })}</tbody></table></div> : <EmptyState icon={ClipboardList} title="Sem fichas técnicas" description="Monte receitas com os insumos cadastrados e acompanhe custo unitário e margem de contribuição." action={<button className="button button-secondary" onClick={() => setSection("products")}><Package size={14} /> Ver produtos</button>} />}</section>}

          {section === "suppliers" && <section className="panel">{filteredSuppliers.length ? <div className="table-wrap"><table><thead><tr><th>Fornecedor</th><th>Categoria</th><th>Contato</th><th>E-mail</th><th>Telefone</th><th></th></tr></thead><tbody>{filteredSuppliers.map((supplier) => <tr key={supplier.id}><td className="table-primary">{supplier.name}</td><td>{supplier.category || "—"}</td><td>{supplier.contact_name || "—"}</td><td>{supplier.email || "—"}</td><td>{supplier.phone || "—"}</td><td><button className="icon-button" aria-label={`Excluir ${supplier.name}`} disabled={busyId === supplier.id} onClick={() => void removeRecord("suppliers", supplier.id)}><Trash2 size={13} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={Factory} title="Nenhum fornecedor cadastrado" description="Organize contatos e categorias de quem abastece sua operação." />}</section>}

          {section === "reports" && <>
            <div className="metric-grid"><Metric icon={ArrowDownLeft} label="Vendas no mês" value={currency.format(sales)} note="Soma dos lançamentos de venda" tone="positive" hint="Total vendido no mês selecionado." /><Metric icon={ArrowUpRight} label="Despesas no mês" value={currency.format(expenses)} note="Soma dos lançamentos de despesa" tone="negative" hint="Total gasto no mês selecionado." /><Metric icon={BarChart3} label="Resultado" value={currency.format(profit)} note="Vendas menos despesas lançadas" tone={profit >= 0 ? "positive" : "negative"} hint="Vendas menos despesas do mês. Positivo é lucro, negativo é prejuízo." /><Metric icon={Activity} label="Margem operacional" value={`${margin.toFixed(1).replace(".", ",")}%`} note="Resultado dividido pelas vendas" hint="Quanto sobra de lucro para cada R$ 1 vendido. Ex.: 20% = R$ 0,20 de lucro por R$ 1 vendido." /></div>
            <section className="panel" style={{ marginTop: 14 }}><div className="panel-header"><div><PanelTitle title="Histórico mensal" hint="Compara vendas e despesas dos últimos 6 meses para mostrar a tendência do negócio." /><p className="panel-description">Consolidado com base nas movimentações registradas</p></div><button className="button button-secondary" onClick={exportCsv}><Download size={14} /> CSV de movimentações</button></div>{hasChartData ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><CartesianGrid stroke="#252b27" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#879188", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#879188", fontSize: 9 }} /><Tooltip formatter={(value) => currency.format(Number(value ?? 0))} contentStyle={{ background: "#171b18", border: "1px solid #343c36", borderRadius: 7 }} /><Area type="monotone" dataKey="vendas" name="Vendas" stroke="#64c690" fill="#64c690" fillOpacity={0.08} /><Area type="monotone" dataKey="despesas" name="Despesas" stroke="#f28a45" fill="#f28a45" fillOpacity={0.08} /></AreaChart></ResponsiveContainer></div> : <div className="empty-chart">Ainda não há movimentações no período para consolidar.</div>}</section>
            <section className="panel" style={{ marginTop: 14 }}><div className="panel-header"><div><PanelTitle title="Base do relatório" hint="Lista das movimentações que alimentam os números deste relatório." /><p className="panel-description">Dados considerados neste painel</p></div><span className="category-pill">{monthEntries.length} lançamento(s) no mês</span></div>{transactionsTable(filteredEntries)}</section>
          </>}

          {section === "insights" && <div className="dashboard-grid"><section className="panel"><div className="panel-header"><div><PanelTitle title="Leitura financeira" hint="Observações geradas automaticamente a partir dos seus lançamentos, estoque e contas." /><p className="panel-description">Sinais calculados com os dados reais desta empresa</p></div><span className="status"><Sparkles size={12} /> Análise de dados</span></div>{insightItems.length ? <div className="insight-list">{insightItems.map((item, index) => <div className="insight-item" key={`${item.title}-${index}`}><div className="insight-icon"><item.icon size={16} /></div><div><strong>{item.title}</strong><p>{item.text}</p></div></div>)}</div> : <EmptyState icon={CircleHelp} title="Dados insuficientes para análise" description="Inclua movimentações, estoque ou contas para gerar observações úteis." />}</section><section className="panel"><div className="panel-header"><div><PanelTitle title="Indicadores considerados" hint="Números usados na leitura: margem, contas em aberto e valor do estoque." /><p className="panel-description">Visão do período atual</p></div></div><div style={{ display: "grid", gap: 13 }}><div><div className="metric-top"><span>Margem registrada</span><span>{margin.toFixed(1).replace(".", ",")}%</span></div><div style={{ height: 5, marginTop: 8, overflow: "hidden", borderRadius: 5, background: "#272d29" }}><div style={{ width: `${Math.min(Math.max(margin, 0), 100)}%`, height: "100%", background: "var(--green)" }} /></div></div><div className="metric-top"><span>Contas a pagar em aberto</span><strong>{currency.format(payableTotal)}</strong></div><div className="metric-top"><span>Contas a receber em aberto</span><strong>{currency.format(receivableTotal)}</strong></div><div className="metric-top"><span>Estoque valorizado a custo</span><strong>{currency.format(inventoryValue)}</strong></div></div><div className="notice" style={{ marginTop: 18 }}>Esta análise usa regras e agregações locais dos seus registros. Nenhum modelo generativo ou dado externo é consultado.</div></section></div>}
        </>}
      </div>
    </main>
    <nav className="mobile-nav" aria-label="Navegação principal">{navigation.map(({ id, icon: Icon }) => <button key={id} className={section === id ? "active" : ""} onClick={() => { setSection(id); setSearch(""); }}><Icon size={17} /><span>{mobileLabels[id]}</span>{isLocked(id) && <Lock size={9} className="mobile-lock" aria-label="Disponível somente com assinatura" />}</button>)}{isPlatformAdmin && <button className={section === "admin" ? "active" : ""} onClick={() => setSection("admin")}><Settings2 size={17} /><span>{mobileLabels.admin}</span></button>}</nav>
    {dialog && <RecordDialog mode={dialog} products={products} onClose={() => setDialog(null)} onSave={saveRecord} />}
  </div>;
}

function AdminOverview({ client }: { client: NonNullable<ReturnType<typeof getSupabaseClient>> }) {
  const [data, setData] = useState<{ organizations: number; subscriptions: number; active_trials: number } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void client.rpc("admin_overview").then(({ data: result, error: rpcError }) => {
      if (!active) return;
      if (rpcError) setError(rpcError.message);
      else setData(result as typeof data);
    });
    return () => { active = false; };
  }, [client]);
  if (error) return <div className="error-message">{error}</div>;
  if (!data) return <div className="skeleton" />;
  return <div className="metric-grid"><Metric icon={Store} label="Empresas" value={String(data.organizations)} note="Total cadastrado" /><Metric icon={CreditCard} label="Assinaturas" value={String(data.subscriptions)} note="Registros de plano" /><Metric icon={Users} label="Períodos de avaliação" value={String(data.active_trials)} note="Status de avaliação ativo" /></div>;
}