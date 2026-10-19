import { useEffect, useState } from 'react';
import { api, type ApiKeyStatus, type User } from '@/api';
import ApiKeyDialog from '@/features/api-key/ApiKeyDialog';
import KnowledgeDialog from '@/features/knowledge/KnowledgeDialog';
import SettingsDialog from '@/features/settings/SettingsDialog';
import { useSettings } from '@/features/settings/SettingsProvider';
import { ChatComposer } from './components/ChatComposer';
import { ChatHeader } from './components/ChatHeader';
import { MessageList } from './components/MessageList';
import { SessionDrawer } from './components/SessionDrawer';
import { SessionSidebar } from './components/SessionSidebar';
import { TokenUsageBadge } from './components/TokenUsageBadge';
import { ToolLogCard } from './components/ToolLogCard';
import { TypingIndicator } from './components/TypingIndicator';
import { WelcomePanel } from './components/WelcomePanel';
import { useChatController } from './useChatController';

/** 已登录后的聊天主界面：只做布局与弹窗编排，业务状态在 useChatController */
export default function ChatPage({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { t } = useSettings();
  const chat = useChatController();

  // 我的 API Key 状态 + 知识库文档数（入口角标）
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [docCount, setDocCount] = useState(0);

  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    api
      .getApiKey()
      .then(setKeyStatus)
      .catch(() => setKeyStatus(null));
    api
      .listDocuments()
      .then((list) => setDocCount(list.length))
      .catch(() => setDocCount(0));
  }, []);

  const needKey = keyStatus !== null && keyStatus.required && !keyStatus.hasKey;
  const sessionTitle = chat.sessions.find((s) => s.id === chat.activeSessionId)?.title;

  return (
    <div className="flex h-screen overflow-hidden bg-night text-ink">
      {/* ================= 左侧品牌栏 + 会话列表（lg+ 显示） ================= */}
      <SessionSidebar
        sessions={chat.sessions}
        activeSessionId={chat.activeSessionId}
        onSelect={chat.openSession}
        onCreate={chat.newSession}
        onDelete={chat.removeSession}
      />

      {/* ================= 主聊天区 ================= */}
      <section className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          user={user}
          sessionTitle={sessionTitle}
          needKey={needKey}
          docCount={docCount}
          onOpenSessions={() => chat.setSessionDrawerOpen(true)}
          onOpenKnowledge={() => setKnowledgeOpen(true)}
          onOpenKey={() => setKeyDialogOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onLogout={onLogout}
        />

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
            {chat.messages.length === 0 && !chat.streaming && <WelcomePanel onPick={chat.send} />}

            <MessageList
              messages={chat.messages}
              streaming={chat.streaming}
              editingIndex={chat.editingIndex}
              editText={chat.editText}
              onEditTextChange={chat.setEditText}
              onStartEdit={(index) => {
                chat.setEditingIndex(index);
                chat.setEditText(chat.messages[index]?.content ?? '');
              }}
              onCancelEdit={() => {
                chat.setEditingIndex(null);
                chat.setEditText('');
              }}
              onSubmitEdit={chat.submitEdit}
              onRegenerate={chat.regenerate}
            />

            <ToolLogCard
              items={chat.toolLog}
              open={chat.toolOpen}
              onToggle={() => chat.setToolOpen((v) => !v)}
            />

            <TokenUsageBadge usage={chat.turnUsage} />

            {chat.streaming && chat.lastIsUser && <TypingIndicator />}

            <div ref={chat.bottomRef} />
          </div>
        </main>

        <ChatComposer
          input={chat.input}
          streaming={chat.streaming}
          onChange={chat.setInput}
          onSend={() => chat.send()}
          onStop={chat.stop}
        />
      </section>

      {/* ================= 移动端会话抽屉 ================= */}
      <SessionDrawer
        open={chat.sessionDrawerOpen}
        sessions={chat.sessions}
        activeSessionId={chat.activeSessionId}
        onClose={() => chat.setSessionDrawerOpen(false)}
        onSelect={chat.openSession}
        onCreate={chat.newSession}
        onDelete={chat.removeSession}
      />

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

      {/* 「我的知识库」弹窗（上传文档 → RAG 检索 → 在线预览） */}
      {knowledgeOpen && (
        <KnowledgeDialog onClose={() => setKnowledgeOpen(false)} onCountChange={setDocCount} />
      )}

      {/* 设置弹窗（外观 / 语言） */}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
