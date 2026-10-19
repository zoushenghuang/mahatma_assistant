import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Session, type SseEvent, type TokenUsage } from '@/api';
import { useSettings } from '@/features/settings/SettingsProvider';
import { useAutoScroll } from '@/shared/hooks/useAutoScroll';
import { useGeolocation } from '@/shared/hooks/useGeolocation';
import { friendlyClientError } from '@/shared/lib/errors';
import { toServerIndex, type ChatMsg, type ToolLogItem } from './types';

/**
 * 聊天页状态控制器
 *
 * 集中管理：会话列表 / 当前会话 / 消息流 / SSE 事件 / 工具日志 / 编辑态 / 定位。
 * 展示层（ChatPage 与 components/*）只负责渲染，不再散落业务逻辑。
 */
export function useChatController() {
  const { t } = useSettings();

  // ===== 会话 =====
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);

  // ===== 消息与流式状态 =====
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [toolLog, setToolLog] = useState<ToolLogItem[]>([]);
  const [toolOpen, setToolOpen] = useState(true);
  const [turnUsage, setTurnUsage] = useState<TokenUsage | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const getLocation = useGeolocation();

  // 有新消息 / 工具日志时自动滚到底部
  useAutoScroll(bottomRef, [messages, toolLog]);

  // 卸载时中止未完成的请求
  useEffect(() => () => abortRef.current?.abort(), []);

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
    setTurnUsage(null);
    setEditingIndex(null);
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
    setTurnUsage(null);
    setEditingIndex(null);
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
          setTurnUsage(null);
          setEditingIndex(null);
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
        if (list.length > 0) openSession(list[0].id);
      } catch (err) {
        console.error('初始化失败:', err);
      }
    })();
  }, [openSession]);

  /** 处理一轮 SSE 事件（发送 / 重新生成 / 编辑重发共用） */
  const handleEvent = useCallback(
    (e: SseEvent) => {
      if (e.type === 'content') {
        // 更新函数必须是纯函数（StrictMode 下会被调用两次），
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
      } else if (e.type === 'usage') {
        // 整轮 token 用量（含工具循环的多轮请求），展示在法宝卡片旁
        setTurnUsage(e.usage);
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
            next[next.length - 1] = {
              role: 'assistant',
              content: e.message,
              failed: true,
              local: true,
            };
          } else {
            next.push({ role: 'assistant', content: e.message, failed: true, local: true });
          }
          return next;
        });
      }
    },
    [t],
  );

  /**
   * 统一的「一轮对话」执行器：发送 / 重新生成 / 编辑重发共用
   * @param prepare 本地消息列表变更（截断 + 追加用户消息）
   * @param request 发起 SSE 请求
   */
  const streamTurn = useCallback(
    async (
      prepare: (prev: ChatMsg[]) => ChatMsg[],
      request: (signal: AbortSignal) => Promise<void>,
    ) => {
      setMessages(prepare);
      setStreaming(true);
      setToolLog([]);
      setTurnUsage(null);
      setToolOpen(true);

      const ac = new AbortController();
      abortRef.current = ac;
      try {
        await request(ac.signal);
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          console.error('对话失败:', err);
          // 连接层异常也用助手消息展示，界面不再出现「系统出错」字样
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: friendlyClientError(err, t), failed: true, local: true },
          ]);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        refreshSessions(); // 标题 / 排序可能变化
      }
    },
    [refreshSessions, t],
  );

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
    setInput('');
    const target = sid;
    // 附带当前位置，供后端查询"当前位置天气"（未授权则为 null，不影响普通对话）
    const location = await getLocation();
    await streamTurn(
      (prev) => [...prev, { role: 'user', content: text }],
      (signal) => api.chatSSE(target, text, location, handleEvent, signal),
    );
  };

  /** 重新生成最后一条回答（后端会丢弃该回答及其后记录） */
  const regenerate = async () => {
    const sid = activeSessionId;
    if (!sid || streaming) return;
    // 找到最后一条「后端确有记录」的用户消息，本地先截断到它
    let lastUser = -1;
    messages.forEach((m, i) => {
      if (m.role === 'user' && !m.local) lastUser = i;
    });
    if (lastUser < 0) return;
    setEditingIndex(null);
    setEditText('');
    const location = await getLocation();
    await streamTurn(
      (prev) => prev.slice(0, lastUser + 1),
      (signal) => api.regenerateSSE(sid, location, handleEvent, signal),
    );
  };

  /** 提交编辑并重发（丢弃该条之后的全部对话） */
  const submitEdit = async (frontIndex: number) => {
    const sid = activeSessionId;
    const text = editText.trim();
    if (!sid || !text || streaming) return;
    const serverIndex = toServerIndex(messages, frontIndex);
    setEditingIndex(null);
    setEditText('');
    const location = await getLocation();
    await streamTurn(
      (prev) => [...prev.slice(0, frontIndex), { role: 'user', content: text }],
      (signal) => api.editMessageSSE(sid, serverIndex, text, location, handleEvent, signal),
    );
  };

  /** 停止生成 */
  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
    // 中断的回答未必已落库，标记为本地消息，避免影响后续索引计算
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === 'assistant') next[next.length - 1] = { ...last, local: true };
      return next;
    });
  };

  const lastIsUser = messages[messages.length - 1]?.role === 'user';

  return {
    // 会话
    sessions,
    activeSessionId,
    sessionDrawerOpen,
    setSessionDrawerOpen,
    openSession,
    newSession,
    removeSession,
    // 消息
    messages,
    input,
    setInput,
    streaming,
    toolLog,
    toolOpen,
    setToolOpen,
    turnUsage,
    editingIndex,
    editText,
    setEditText,
    setEditingIndex,
    bottomRef,
    lastIsUser,
    // 动作
    send,
    regenerate,
    submitEdit,
    stop,
  };
}
