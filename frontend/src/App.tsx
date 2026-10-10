import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  clearToken,
  getToken,
  setUnauthorizedHandler,
  type ApiKeyStatus,
  type Session,
  type SseEvent,
  type User,
} from './api';
import AuthPage from './AuthPage';
import ApiKeyDialog, { KeyIcon } from './ApiKeyDialog';
import KnowledgeDialog, { BookIcon } from './KnowledgeDialog';
import SettingsDialog from './SettingsDialog';
import { useSettings, type Translate } from './settings';

// ============ 类型 ============

// 当前对话消息
interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  // 该条助手消息是失败提示（Key 无效 / 网络异常等），用警示样式渲染
  failed?: boolean;
}

// 工具调用日志（结构化，便于卡片化展示）
interface ToolLogItem {
  name: string;
  result?: string;
  error?: string;
}

// ============ SVG 图标（ui-ux-pro-max 规范：图标一律用 SVG，不用 emoji） ============

/** 金箍棒徽章 */
function StaffLogo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <circle cx="20" cy="20" r="19" fill="#12151E" stroke="#F0B429" strokeWidth="1.5" />
      <rect x="18" y="6" width="4" height="28" rx="2" fill="#F0B429" />
      <rect x="14.5" y="9" width="11" height="4" rx="2" fill="#E5484D" />
      <rect x="14.5" y="27" width="11" height="4" rx="2" fill="#E5484D" />
      <path d="M20 3.5c1.5 2 1.5 3 0 4.5-1.5-1.5-1.5-2.5 0-4.5z" fill="#FFD97A" />
      <path d="M20 32c1.5 2 1.5 3 0 4.5-1.5-1.5-1.5-2.5 0-4.5z" fill="#FFD97A" />
    </svg>
  );
}

/** 纸飞机 · 发送 */
function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}

/** 方块 · 停止生成 */
function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** 垃圾桶 · 删除会话 */
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** 加号 · 新建会话 */
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

/** 会话历史图标 */
function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

/** 齿轮 · 法宝 / 工具调用 */
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** 关闭 · 移动端抽屉 */
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/** 右键头 · 折叠箭头 */
function ChevronIcon({ open, className = 'h-4 w-4' }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** 滑杆 · 设置 */
function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </svg>
  );
}

/** 门 · 退出登录 */
function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

// ============ 登录态门禁 ============

/**
 * 应用入口：未登录 → 登录/注册页；已登录 → 聊天主界面
 * 刷新时先用本地 token 换一次 /api/auth/me，失效则回到登录页
 */
export default function App() {
  const { t } = useSettings();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // 登录失效统一回到登录页
    setUnauthorizedHandler(() => setUser(null));

    if (!getToken()) {
      setChecking(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  // 校验登录态时的加载占位
  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-night">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-night-600 border-t-gold" />
          <p className="text-sm text-ink-faint">{t('app.checking')}</p>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage onAuthed={setUser} />;
  return <ChatApp user={user} onLogout={logout} />;
}

// ============ 主组件（已登录）============

function ChatApp({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { t } = useSettings();

  // 我的 API Key 状态（未设置时提示先填写，对话用自己的 Key）
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false); // 知识库面板
  const [docCount, setDocCount] = useState(0); // 已上传文档数（入口角标）
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // 头像下拉菜单
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击头像菜单外部时收起
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  // 空状态示例问题（对应工具能力）
  const examples = [
    { label: t('chat.exampleWeatherLabel'), text: t('chat.exampleWeatherText') },
    { label: t('knowledge.entry'), text: t('knowledge.exampleText') },
    { label: t('chat.exampleEchoLabel'), text: t('chat.exampleEchoText') },
  ];

  useEffect(() => {
    api
      .getApiKey()
      .then(setKeyStatus)
      .catch(() => setKeyStatus(null));
    // 知识库文档数（入口角标）
    api
      .listDocuments()
      .then((list) => setDocCount(list.length))
      .catch(() => setDocCount(0));
  }, []);

  const needKey = keyStatus !== null && keyStatus.required && !keyStatus.hasKey;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [toolLog, setToolLog] = useState<ToolLogItem[]>([]);
  const [toolOpen, setToolOpen] = useState(true);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false); // 移动端会话抽屉
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ===== 会话管理 =====

  /** 刷新会话列表（新建/删除/对话后调用） */
  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await api.listSessions());
    } catch (err) {
      console.error('加载会话列表失败:', err);
    }
  }, []);

  /** 进入某个会话（加载历史） */
  const openSession = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setActiveSessionId(id);
    setToolLog([]);
    setStreaming(false);
    try {
      const history = await api.getMessages(id);
      setMessages(history as ChatMsg[]);
    } catch {
      setMessages([]);
    }
    setSessionDrawerOpen(false);
  }, []);

  /** 新建会话 */
  const newSession = useCallback(async () => {
    abortRef.current?.abort();
    setMessages([]);
    setToolLog([]);
    setStreaming(false);
    setInput('');
    try {
      const s = await api.createSession();
      setActiveSessionId(s.id);
      setSessions((prev) => [s, ...prev]);
    } catch (err) {
      console.error('新建会话失败:', err);
    }
    setSessionDrawerOpen(false);
  }, []);

  /** 删除会话（删除当前会话时自动切换） */
  const removeSession = useCallback(
    async (id: string) => {
      if (id === activeSessionId) abortRef.current?.abort();
      try {
        await api.deleteSession(id);
      } catch {
        return;
      }
      const next = sessions.filter((s) => s.id !== id);
      setSessions(next);
      if (id === activeSessionId) {
        if (next.length > 0) {
          openSession(next[0].id); // 切到最近活跃的会话
        } else {
          setActiveSessionId(null);
          setMessages([]);
          setToolLog([]);
          setStreaming(false);
        }
      }
    },
    [activeSessionId, sessions, openSession],
  );

  // 进入页面：加载会话列表，非空则自动进入最近会话
  useEffect(() => {
    (async () => {
      try {
        const list = await api.listSessions();
        setSessions(list);
        if (list.length > 0) {
          openSession(list[0].id);
        }
      } catch (err) {
        console.error('初始化失败:', err);
      }
    })();
  }, [openSession]);

  // 有新消息/工具日志时自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolLog]);

  // ===== 对话 =====

  const send = async (prefill?: string) => {
    const text = (prefill ?? input).trim();
    if (!text || streaming) return;

    // 没有当前会话时先自动新建
    let sid = activeSessionId;
    if (!sid) {
      try {
        const s = await api.createSession();
        sid = s.id;
        setActiveSessionId(s.id);
        setSessions((prev) => [s, ...prev]);
      } catch {
        return;
      }
    }

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setStreaming(true);
    setToolLog([]);
    setToolOpen(true);

    const ac = new AbortController();
    abortRef.current = ac;

    const handleEvent = (e: SseEvent) => {
      if (e.type === 'content') {
        // 注意：更新函数必须是纯函数（StrictMode 下会被调用两次），
        // 所以不能改旧对象，要新建「最后一条消息」再替换
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant') {
            next[next.length - 1] = { ...last, content: last.content + e.text };
          } else {
            next.push({ role: 'assistant', content: e.text });
          }
          return next;
        });
      } else if (e.type === 'tool_start') {
        setToolLog((prev) => [...prev, { name: e.name }]);
      } else if (e.type === 'tool_end') {
        setToolLog((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) next[next.length - 1] = { ...last, result: e.result };
          return next;
        });
      } else if (e.type === 'error') {
        // 只是某个工具失败：记进法宝日志，对话继续
        if (e.fatal === false) {
          setToolLog((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last) next[next.length - 1] = { ...last, error: e.message };
            else next.push({ name: t('chat.toolName'), error: e.message });
            return next;
          });
          return;
        }
        // 整轮对话失败（如 API Key 无效）：作为一条助手消息展示友好文案
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant') {
            // 已流式输出一半才失败：用完整文案覆盖，避免留在半截内容
            next[next.length - 1] = { role: 'assistant', content: e.message, failed: true };
          } else {
            next.push({ role: 'assistant', content: e.message, failed: true });
          }
          return next;
        });
      }
    };

    try {
      await api.chatSSE(sid, text, handleEvent, ac.signal);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('对话失败:', err);
        // 连接层异常也用助手消息展示，界面不再出现「系统出错」字样
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: friendlyClientError(err, t), failed: true },
        ]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      refreshSessions(); // 标题 / 排序可能变化
    }
  };

  /** 停止生成 */
  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const lastIsUser = messages[messages.length - 1]?.role === 'user';

  return (
    <div className="flex h-screen overflow-hidden bg-night text-ink">
      {/* ================= 左侧品牌栏 + 会话列表（lg+ 显示） ================= */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-night-700/60 bg-night-900/60 lg:flex">
        {/* 品牌区 */}
        <div className="flex items-center gap-3 px-6 py-5">
          <StaffLogo className="h-10 w-10 drop-shadow-glow-gold-sm" />
          <div>
            <h1 className="font-display text-lg font-bold tracking-wide text-gold-100">{t('app.name')}</h1>
            <p className="text-xs text-ink-faint">{t('app.tagline')}</p>
          </div>
        </div>

        {/* 新建会话 */}
        <div className="px-4">
          <button
            onClick={newSession}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-medium text-accentInk transition hover:brightness-110 hover:shadow-glow-gold"
          >
            <PlusIcon />
            {t('chat.newSession')}
          </button>
        </div>

        {/* 会话列表 */}
        <div className="mt-4 flex min-h-0 flex-1 flex-col px-3">
          <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-widest text-ink-faint">
            {t('chat.history')}
          </p>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {sessions.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-ink-faint">{t('chat.noSessions')}</p>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => openSession(s.id)}
                className={`group flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 transition ${
                  s.id === activeSessionId
                    ? 'border-gold/40 bg-gold/10 text-gold-100'
                    : 'border-transparent text-ink-muted hover:border-night-600 hover:bg-night-800/60 hover:text-ink'
                }`}
              >
                <HistoryIcon />
                <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSession(s.id);
                  }}
                  aria-label={t('chat.deleteSession', { title: s.title })}
                  className="shrink-0 cursor-pointer rounded-md p-1 text-ink-faint opacity-0 transition hover:bg-cinnabar/20 hover:text-cinnabar group-hover:opacity-100"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 底部说明 */}
        <div className="px-4 py-4 text-[11px] leading-relaxed text-ink-faint">
          {t('chat.footer')}
        </div>
      </aside>

      {/* ================= 主聊天区 ================= */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* 顶部栏（移动端含品牌 + 会话抽屉入口） */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-night-700/60 bg-night-900/40 px-4 backdrop-blur">
          <div className="flex items-center gap-3">
            {/* 移动端：会话列表抽屉入口 */}
            <button
              onClick={() => setSessionDrawerOpen(true)}
              aria-label={t('chat.openSessions')}
              className="cursor-pointer rounded-lg border border-night-600 p-1.5 text-ink-muted transition hover:border-gold/40 hover:text-gold lg:hidden"
            >
              <HistoryIcon />
            </button>
            <StaffLogo className="h-8 w-8 lg:hidden" />
            <h1 className="font-display text-base font-bold tracking-wide text-gold-100 lg:hidden">{t('app.name')}</h1>
            {/* 桌面端：当前会话标题 + 在线状态 */}
            <div className="hidden items-center gap-2 lg:flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-gold" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
              </span>
              <span className="max-w-[260px] truncate text-sm text-ink-muted">
                {sessions.find((s) => s.id === activeSessionId)?.title ?? t('chat.online')}
              </span>
            </div>
          </div>

          {/* 右侧：知识库 + 我的 Key + 用户头像（点击弹出设置菜单） */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setKnowledgeOpen(true)}
              title={t('knowledge.title')}
              className="relative flex cursor-pointer items-center gap-1.5 rounded-xl border border-night-600 px-2.5 py-1.5 text-xs text-ink-muted transition hover:border-gold/40 hover:text-gold"
            >
              <BookIcon />
              <span className="hidden sm:inline">{t('knowledge.entry')}</span>
              {docCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 font-display text-[10px] font-bold text-accentInk">
                  {docCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setKeyDialogOpen(true)}
              title={t('key.title')}
              className={`flex cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs transition ${
                needKey
                  ? 'border-cinnabar/50 text-cinnabar-400 hover:bg-cinnabar/10'
                  : 'border-night-600 text-ink-muted hover:border-gold/40 hover:text-gold'
              }`}
            >
              <KeyIcon />
              <span className="hidden sm:inline">{t('chat.myKey')}</span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${needKey ? 'bg-cinnabar' : 'bg-gold'}`}
                aria-hidden="true"
              />
            </button>

            {/* 头像 → 下拉菜单（设置 / 退出登录） */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                title={user.nickname || user.username}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={`flex max-w-[160px] cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 transition ${
                  menuOpen
                    ? 'border-gold/50 bg-night-800 text-ink'
                    : 'border-night-600 bg-night-800/60 text-ink-muted hover:border-gold/40 hover:text-ink'
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gold/15 font-display text-xs font-bold text-gold">
                  {(user.nickname || user.username).slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate text-xs">{user.nickname || user.username}</span>
                <span className="shrink-0 text-ink-faint">
                  <ChevronIcon open={menuOpen} className="h-3 w-3" />
                </span>
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-40 mt-2 w-40 animate-fade-in overflow-hidden rounded-xl border border-night-600 bg-night-800 py-1 shadow-panel"
                >
                  <div className="border-b border-night-700/60 px-3 pb-1.5 pt-1">
                    <p className="truncate text-xs font-medium text-ink">{user.nickname || user.username}</p>
                    <p className="truncate text-[11px] text-ink-faint">{user.email}</p>
                  </div>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setSettingsOpen(true);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-ink-muted transition hover:bg-night-700/60 hover:text-ink"
                  >
                    <SettingsIcon />
                    {t('common.settings')}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-ink-muted transition hover:bg-cinnabar/10 hover:text-cinnabar-400"
                  >
                    <LogoutIcon />
                    {t('common.logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* 未配置 Key 时的引导条 */}
        {needKey && (
          <div className="flex items-center justify-between gap-3 border-b border-cinnabar/30 bg-cinnabar/10 px-4 py-2.5">
            <p className="text-xs leading-relaxed text-cinnabar-400">{t('chat.needKey')}</p>
            <button
              onClick={() => setKeyDialogOpen(true)}
              className="shrink-0 cursor-pointer rounded-lg border border-cinnabar/50 px-3 py-1.5 text-xs text-cinnabar-400 transition hover:bg-cinnabar/20"
            >
              {t('chat.goFillKey')}
            </button>
          </div>
        )}

        {/* 消息区 */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
            {/* 空状态欢迎 */}
            {messages.length === 0 && !streaming && (
              <div className="animate-fade-up pt-16 text-center">
                <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
                  <span className="absolute inset-0 animate-pulse-ring rounded-3xl border border-gold/40" />
                  <StaffLogo className="h-20 w-20 drop-shadow-glow-gold-sm" />
                </div>
                <h2 className="mt-6 font-display text-2xl font-bold text-gold-100">
                  {t('chat.heroTitle')}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
                  {t('chat.heroSub')}
                </p>
                <div className="mx-auto mt-8 grid max-w-lg gap-3 sm:grid-cols-2">
                  {examples.map((ex) => (
                    <button
                      key={ex.text}
                      onClick={() => send(ex.text)}
                      className="group cursor-pointer rounded-2xl border border-night-600 bg-night-800/60 p-4 text-left transition hover:border-gold/50 hover:bg-night-700/50 hover:shadow-glow-gold-sm"
                    >
                      <span className="text-xs font-medium text-gold">{ex.label}</span>
                      <span className="mt-1.5 block text-sm leading-relaxed text-ink transition group-hover:text-gold-100">
                        {ex.text}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 对话气泡 */}
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex animate-fade-up justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-bubble-user px-4 py-2.5 text-sm leading-relaxed text-accentInk shadow-glow-gold-sm">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex animate-fade-up items-start gap-3">
                  <div className="mt-0.5 shrink-0 rounded-xl border border-night-600 bg-night-800 p-1.5">
                    <StaffLogo className="h-6 w-6" />
                  </div>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border px-4 py-2.5 text-sm leading-relaxed ${
                      m.failed
                        ? 'border-cinnabar/40 bg-cinnabar/10 text-cinnabar-400'
                        : 'border-night-600 bg-night-800/80 text-ink'
                    }`}
                  >
                    {m.failed && (
                      <span className="mb-1 block text-xs font-medium opacity-80">{t('chat.tip')}</span>
                    )}
                    {m.content}
                  </div>
                </div>
              ),
            )}

            {/* 法宝调用日志（可折叠卡片） */}
            {toolLog.length > 0 && (
              <div className="animate-fade-in overflow-hidden rounded-2xl border border-night-600 bg-night-900/70">
                <button
                  onClick={() => setToolOpen((v) => !v)}
                  className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left transition hover:bg-night-800/60"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-gold">
                    <GearIcon />
                    {t('chat.tools')}
                    <span className="rounded-md bg-gold/10 px-1.5 py-0.5 font-display text-xs text-gold">
                      {toolLog.length}
                    </span>
                  </span>
                  <span className="text-ink-faint">
                    <ChevronIcon open={toolOpen} />
                  </span>
                </button>
                {toolOpen && (
                  <div className="space-y-2 border-t border-night-700/60 px-4 py-3">
                    {toolLog.map((item, i) => (
                      <div key={i} className="rounded-xl border border-night-700/60 bg-night-800/60 px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.error ? 'bg-cinnabar' : 'bg-gold'}`}
                          />
                          <span className="font-mono text-xs font-medium text-ink">
                            {item.error ? t('chat.toolFailed', { name: item.name }) : item.name}
                          </span>
                        </div>
                        {(item.result || item.error) && (
                          <p className="mt-1.5 break-all font-mono text-xs leading-relaxed text-ink-faint">
                            {item.error ?? (item.result && truncate(item.result))}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 等待首个 token 时的「思考中」占位 */}
            {streaming && lastIsUser && (
              <div className="flex animate-fade-up items-start gap-3">
                <div className="mt-0.5 shrink-0 rounded-xl border border-night-600 bg-night-800 p-1.5">
                  <StaffLogo className="h-6 w-6" />
                </div>
                <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-night-600 bg-night-800/80 px-4 py-3.5">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="h-1.5 w-1.5 animate-bounce-dot rounded-full bg-gold"
                      style={{ animationDelay: `${d * 0.15}s` }}
                    />
                  ))}
                  <span className="ml-1 text-xs text-ink-faint">{t('chat.thinking')}</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </main>

        {/* 底部输入区 */}
        <footer className="shrink-0 border-t border-night-700/60 bg-night-900/40 px-4 pb-4 pt-3 backdrop-blur">
          <form
            className="mx-auto flex max-w-3xl items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="flex flex-1 items-center gap-2 rounded-2xl border border-night-600 bg-night-800/80 px-4 py-3 transition focus-within:border-gold/60 focus-within:shadow-glow-gold-sm">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t('chat.inputPlaceholder')}
                disabled={streaming}
                className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed"
              />
            </div>
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                aria-label={t('chat.stop')}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl border border-cinnabar/50 bg-cinnabar/10 text-cinnabar transition hover:bg-cinnabar/20"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label={t('chat.send')}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl bg-gold-gradient text-accentInk transition hover:brightness-110 hover:shadow-glow-gold disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                <SendIcon />
              </button>
            )}
          </form>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-ink-faint">
            {t('chat.footer')}
          </p>
        </footer>
      </section>

      {/* ================= 移动端会话抽屉 ================= */}
      {sessionDrawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          {/* 遮罩 */}
          <div className="absolute inset-0 bg-black/60" onClick={() => setSessionDrawerOpen(false)} />
          {/* 抽屉 */}
          <div className="relative z-10 flex h-full w-72 flex-col border-r border-night-700 bg-night-900 p-4 shadow-panel">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-gold-100">{t('chat.history')}</h2>
              <button
                onClick={() => setSessionDrawerOpen(false)}
                aria-label={t('chat.closeSessions')}
                className="cursor-pointer rounded-lg p-1.5 text-ink-muted transition hover:text-ink"
              >
                <CloseIcon />
              </button>
            </div>
            <button
              onClick={newSession}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-medium text-accentInk"
            >
              <PlusIcon />
              {t('chat.newSession')}
            </button>
            <div className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto">
              {sessions.length === 0 && (
                <p className="py-4 text-center text-xs text-ink-faint">{t('chat.noSessions')}</p>
              )}
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => openSession(s.id)}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${
                    s.id === activeSessionId
                      ? 'border-gold/40 bg-gold/10 text-gold-100'
                      : 'border-transparent text-ink-muted hover:bg-night-800/60'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSession(s.id);
                    }}
                    aria-label={t('chat.deleteSession', { title: s.title })}
                    className="shrink-0 cursor-pointer rounded-md p-1 text-ink-faint transition hover:bg-cinnabar/20 hover:text-cinnabar"
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 「我的 Key」弹窗 */}
      {keyDialogOpen && (
        <ApiKeyDialog
          onClose={() => setKeyDialogOpen(false)}
          onSaved={(status) => {
            setKeyStatus(status);
            setKeyDialogOpen(false);
          }}
        />
      )}

      {/* 「我的知识库」弹窗（上传文档 → RAG 检索） */}
      {knowledgeOpen && (
        <KnowledgeDialog onClose={() => setKnowledgeOpen(false)} onCountChange={setDocCount} />
      )}

      {/* 设置弹窗（外观 / 语言） */}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

// 结果过长时截断展示
function truncate(text: string, max = 120) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 连接层异常的友好文案
 * 后端返回的文案（如「登录已失效，请重新登录」）已是给用户看的，优先透传；
 * 浏览器原生报错（Failed to fetch 等）则翻译成人话。
 */
function friendlyClientError(err: unknown, t: Translate): string {
  const raw = String((err as any)?.message ?? err ?? '').trim();
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return t('chat.networkError');
  }
  return raw || t('chat.unknownError');
}
