import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * 全局设置：外观（浅色 / 深色）+ 语言（中文 / English）
 *
 * - 主题通过 <html data-theme="..."> 生效（设计令牌见 index.css），
 *   index.html 里有一段内联脚本做首屏防闪烁；
 * - 语言通过 t(key) 取文案，词条集中在下面的字典里；
 * - 两者都持久化在 localStorage。
 */

export type Lang = 'zh' | 'en';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = { theme: 'dasheng_theme', lang: 'dasheng_lang' } as const;

// ============ 文案字典（中文） ============

const zh = {
  // 通用
  'common.settings': '设置',
  'common.logout': '退出登录',
  'common.close': '关闭',
  // 应用
  'app.name': '大圣助手',
  'app.tagline': '金箍棒一挥 · 法宝随手调用',
  'app.checking': '正在校验登录状态…',
  // 设置弹窗
  'settings.title': '设置',
  'settings.sub': '个性化你的大圣助手',
  'settings.appearance': '外观设置',
  'settings.appearanceHint': '选择界面背景主题',
  'settings.light': '浅色',
  'settings.lightDesc': '明亮清爽，适合白天',
  'settings.dark': '深色',
  'settings.darkDesc': '暗夜护眼，适合夜间',
  'settings.language': '语言设置',
  'settings.languageHint': '选择界面显示语言',
  'settings.zh': '中文',
  'settings.zhDesc': '简体中文界面',
  'settings.en': 'English',
  'settings.enDesc': '英文界面',
  // 登录 / 注册 / 找回密码
  'auth.loginTitle': '登录大圣助手',
  'auth.loginSub': '金箍棒在手，法宝随时调用',
  'auth.registerTitle': '注册新账号',
  'auth.registerSub': '一个账号，开启七十二变',
  'auth.forgotTitle': '找回密码',
  'auth.forgotSub': '验证账号与预留邮箱',
  'auth.resetTitle': '设置新密码',
  'auth.resetSub': '验证通过，请输入新密码',
  'auth.username': '账号',
  'auth.usernameHint': '3-20 位字母、数字或下划线',
  'auth.usernamePlaceholder': '请输入账号',
  'auth.email': '邮箱',
  'auth.emailHint': '用于找回密码',
  'auth.nickname': '昵称',
  'auth.nicknameHint': '选填，默认与账号相同',
  'auth.nicknamePlaceholder': '怎么称呼你？',
  'auth.password': '密码',
  'auth.newPassword': '新密码',
  'auth.passwordHint': '至少 8 位',
  'auth.passwordPlaceholder': '请输入密码',
  'auth.confirmPassword': '确认密码',
  'auth.confirmPlaceholder': '再输入一次密码',
  'auth.showPassword': '显示密码',
  'auth.hidePassword': '隐藏密码',
  'auth.resetToken': '重置令牌',
  'auth.resetTokenHint': '演示环境直接返回；接入邮件后由链接携带',
  'auth.resetTokenPlaceholder': '重置令牌',
  'auth.passwordMismatch': '两次输入的密码不一致',
  'auth.forgotNotice': '验证通过！演示环境未接入邮件服务，重置令牌已生成并自动填入下一步。',
  'auth.resetNotice': '密码已重置，请用账号 {username} 重新登录',
  'auth.failed': '操作失败，请重试',
  'auth.processing': '处理中…',
  'auth.login': '登录',
  'auth.registerAndLogin': '注册并登录',
  'auth.verify': '验证身份',
  'auth.submitReset': '重置密码',
  'auth.toRegister': '没有账号？立即注册',
  'auth.toForgot': '忘记密码？',
  'auth.backToLogin': '返回登录',
  'auth.demoAccounts': '演示账号：',
  // 聊天主界面
  'chat.openSessions': '打开会话列表',
  'chat.closeSessions': '关闭会话列表',
  'chat.deleteSession': '删除会话 {title}',
  'chat.online': '在线 · 听候差遣',
  'chat.myKey': '我的 Key',
  'chat.newSession': '新建会话',
  'chat.history': '会话历史',
  'chat.noSessions': '暂无会话，先新建一个吧',
  'chat.needKey':
    '尚未填写 DeepSeek API Key，对话将无法进行。请在「我的 Key」中填入你自己的 Key（仅用于你本人的会话）。',
  'chat.goFillKey': '去填写',
  'chat.heroTitle': '大圣在此，有何吩咐？',
  'chat.heroSub': '本座通晓 Function Calling 与 MCP 法宝，会话记忆持久保存，刷新不丢。',
  'chat.exampleWeatherLabel': '本地法宝 · getWeather',
  'chat.exampleWeatherText': '长沙今天要不要穿棉袄？',
  'chat.exampleEchoLabel': 'MCP 法宝 · echo',
  'chat.exampleEchoText': '用 echo 工具输出测试文本',
  'chat.tip': '提示',
  'chat.tools': '法宝调用',
  'chat.toolName': '工具',
  'chat.toolFailed': '{name}（出错）',
  'chat.thinking': '大圣正在掐指推算…',
  'chat.inputPlaceholder': '禀报大圣，有何事相求…',
  'chat.stop': '停止生成',
  'chat.send': '发送',
  'chat.footer': 'Function Calling + MCP · 会话上下文记忆（MySQL 持久化 · 按账号隔离）',
  'chat.networkError': '网络好像开小差了，检查一下网络或稍后再试试～',
  'chat.unknownError': '大圣这边出了点小状况，稍后再试一次吧～',
  // 我的 Key 弹窗
  'key.title': '我的 API Key',
  'key.sub': '仅用于你本人的对话，不会给其他账号使用',
  'key.statusLabel': '当前状态：',
  'key.configured': '已设置',
  'key.notConfigured': '未设置',
  'key.field': 'DeepSeek API Key',
  'key.placeholderReplace': '已保存，输入新的可覆盖',
  'key.show': '显示',
  'key.hide': '隐藏',
  'key.help': '在 platform.deepseek.com 申请；服务端 AES-256-GCM 加密存储，列表/查询只返回脱敏值。',
  'key.empty': '请输入 API Key',
  'key.saved': '已保存，之后的对话都会用你自己的 Key',
  'key.saveFailed': '保存失败，请重试',
  'key.removeFailed': '删除失败，请重试',
  'key.removed': '已删除，需重新填写才能继续对话',
  'key.save': '保存',
  'key.saving': '保存中…',
  'key.delete': '删除',
  // 知识库（RAG）
  'knowledge.entry': '知识库',
  'knowledge.title': '我的知识库',
  'knowledge.sub': '上传文档，大圣便能“翻阅”你的资料作答',
  'knowledge.upload': '上传文档',
  'knowledge.uploadHint': '支持 {types}，单个文件不超过 {size}MB',
  'knowledge.dragHint': '点击选择，或将文件拖到这里',
  'knowledge.processing': '解析中…',
  'knowledge.empty': '还没有文档，上传一份资料试试吧',
  'knowledge.chunks': '{count} 段',
  'knowledge.statusReady': '已就绪',
  'knowledge.statusPending': '解析中',
  'knowledge.statusFailed': '解析失败',
  'knowledge.delete': '删除文档 {name}',
  'knowledge.removeFailed': '删除失败，请重试',
  'knowledge.uploadFailed': '上传失败，请重试',
  'knowledge.tooLarge': '文件「{name}」超过 {size}MB，已跳过',
  'knowledge.uploaded': '已上传《{name}》，切分为 {count} 段',
  'knowledge.usage': '上传后直接在对话里提问即可（如“根据我上传的文档…”），大圣会自动检索相关资料。',
  'knowledge.total': '共 {count} 份文档',
  'knowledge.close': '关闭知识库',
  'knowledge.exampleText': '阅读我上传的资料，并总结其中的要点',
};

type TKey = keyof typeof zh;

// ============ 文案字典（英文） ============

const en: Record<TKey, string> = {
  'common.settings': 'Settings',
  'common.logout': 'Sign out',
  'common.close': 'Close',
  'app.name': 'Dasheng Assistant',
  'app.tagline': 'One swing of the staff, all tools at hand',
  'app.checking': 'Checking your session…',
  'settings.title': 'Settings',
  'settings.sub': 'Make Dasheng yours',
  'settings.appearance': 'Appearance',
  'settings.appearanceHint': 'Choose a background theme',
  'settings.light': 'Light',
  'settings.lightDesc': 'Bright and clean, great for daytime',
  'settings.dark': 'Dark',
  'settings.darkDesc': 'Easy on the eyes at night',
  'settings.language': 'Language',
  'settings.languageHint': 'Choose the interface language',
  'settings.zh': '中文',
  'settings.zhDesc': 'Simplified Chinese interface',
  'settings.en': 'English',
  'settings.enDesc': 'English interface',
  'auth.loginTitle': 'Sign in to Dasheng',
  'auth.loginSub': 'Your staff in hand, tools on call',
  'auth.registerTitle': 'Create an account',
  'auth.registerSub': 'One account, seventy-two transformations',
  'auth.forgotTitle': 'Reset password',
  'auth.forgotSub': 'Verify your account and email',
  'auth.resetTitle': 'Set a new password',
  'auth.resetSub': 'Verified — enter your new password',
  'auth.username': 'Username',
  'auth.usernameHint': '3-20 letters, digits or underscores',
  'auth.usernamePlaceholder': 'Enter your username',
  'auth.email': 'Email',
  'auth.emailHint': 'Used to recover your password',
  'auth.nickname': 'Nickname',
  'auth.nicknameHint': 'Optional, defaults to your username',
  'auth.nicknamePlaceholder': 'What should we call you?',
  'auth.password': 'Password',
  'auth.newPassword': 'New password',
  'auth.passwordHint': 'At least 8 characters',
  'auth.passwordPlaceholder': 'Enter your password',
  'auth.confirmPassword': 'Confirm password',
  'auth.confirmPlaceholder': 'Enter the password again',
  'auth.showPassword': 'Show password',
  'auth.hidePassword': 'Hide password',
  'auth.resetToken': 'Reset token',
  'auth.resetTokenHint': 'Returned directly in this demo; carried by the email link in production',
  'auth.resetTokenPlaceholder': 'Reset token',
  'auth.passwordMismatch': 'The two passwords do not match',
  'auth.forgotNotice': 'Verified! No mail service in this demo, so the reset token was generated and filled in for you.',
  'auth.resetNotice': 'Password reset. Please sign in as {username} again.',
  'auth.failed': 'Something went wrong, please retry',
  'auth.processing': 'Working…',
  'auth.login': 'Sign in',
  'auth.registerAndLogin': 'Sign up & sign in',
  'auth.verify': 'Verify identity',
  'auth.submitReset': 'Reset password',
  'auth.toRegister': 'No account? Sign up',
  'auth.toForgot': 'Forgot password?',
  'auth.backToLogin': 'Back to sign in',
  'auth.demoAccounts': 'Demo accounts: ',
  'chat.openSessions': 'Open session list',
  'chat.closeSessions': 'Close session list',
  'chat.deleteSession': 'Delete session {title}',
  'chat.online': 'Online · at your service',
  'chat.myKey': 'My Key',
  'chat.newSession': 'New chat',
  'chat.history': 'History',
  'chat.noSessions': 'No conversations yet — create one first',
  'chat.needKey':
    'DeepSeek API Key missing, so chatting is unavailable. Add your own key under “My Key” (used only for your own conversations).',
  'chat.goFillKey': 'Add key',
  'chat.heroTitle': 'Dasheng is here. What can I do for you?',
  'chat.heroSub': 'I wield Function Calling and MCP tools, and remember every conversation across refreshes.',
  'chat.exampleWeatherLabel': 'Local tool · getWeather',
  'chat.exampleWeatherText': 'Do I need a coat in Changsha today?',
  'chat.exampleEchoLabel': 'MCP tool · echo',
  'chat.exampleEchoText': 'Use the echo tool to print a test message',
  'chat.tip': 'Notice',
  'chat.tools': 'Tool calls',
  'chat.toolName': 'Tool',
  'chat.toolFailed': '{name} (failed)',
  'chat.thinking': 'Dasheng is calculating…',
  'chat.inputPlaceholder': 'Tell Dasheng what you need…',
  'chat.stop': 'Stop generating',
  'chat.send': 'Send',
  'chat.footer': 'Function Calling + MCP · persistent memory (MySQL, isolated per account)',
  'chat.networkError': 'Network hiccup — check your connection and try again.',
  'chat.unknownError': 'Something went wrong on our side. Please try again later.',
  'key.title': 'My API Key',
  'key.sub': 'Used only for your own conversations, never shared',
  'key.statusLabel': 'Status: ',
  'key.configured': 'Configured',
  'key.notConfigured': 'Not set',
  'key.field': 'DeepSeek API Key',
  'key.placeholderReplace': 'Saved — enter a new one to replace',
  'key.show': 'Show',
  'key.hide': 'Hide',
  'key.help': 'Get one at platform.deepseek.com. Stored server-side with AES-256-GCM; reads only return a masked value.',
  'key.empty': 'Please enter an API Key',
  'key.saved': 'Saved — future chats will use your own key',
  'key.saveFailed': 'Failed to save, please retry',
  'key.removeFailed': 'Failed to delete, please retry',
  'key.removed': 'Deleted — add a key again to keep chatting',
  'key.save': 'Save',
  'key.saving': 'Saving…',
  'key.delete': 'Delete',
  'knowledge.entry': 'Knowledge',
  'knowledge.title': 'My Knowledge Base',
  'knowledge.sub': 'Upload documents and Dasheng will answer from your own files',
  'knowledge.upload': 'Upload document',
  'knowledge.uploadHint': 'Supports {types}, up to {size}MB per file',
  'knowledge.dragHint': 'Click to choose, or drop files here',
  'knowledge.processing': 'Parsing…',
  'knowledge.empty': 'No documents yet — upload one to try',
  'knowledge.chunks': '{count} chunks',
  'knowledge.statusReady': 'Ready',
  'knowledge.statusPending': 'Parsing',
  'knowledge.statusFailed': 'Failed',
  'knowledge.delete': 'Delete document {name}',
  'knowledge.removeFailed': 'Failed to delete, please retry',
  'knowledge.uploadFailed': 'Upload failed, please retry',
  'knowledge.tooLarge': '“{name}” exceeds {size}MB and was skipped',
  'knowledge.uploaded': '“{name}” uploaded — split into {count} chunks',
  'knowledge.usage': 'Just ask in the chat (e.g. “based on my uploaded document…”), Dasheng will retrieve the relevant parts.',
  'knowledge.total': '{count} document(s)',
  'knowledge.close': 'Close knowledge base',
  'knowledge.exampleText': 'Read my uploaded documents and summarize the key points',
};

const DICTS: Record<Lang, Record<TKey, string>> = { zh, en };

export type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

interface SettingsValue {
  theme: Theme;
  lang: Lang;
  setTheme: (theme: Theme) => void;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const SettingsContext = createContext<SettingsValue | null>(null);

/** 从 localStorage 读取并校验取值 */
function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可
  }
  return fallback;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    readStored(STORAGE_KEY.theme, ['light', 'dark'] as const, 'dark'),
  );
  const [lang, setLangState] = useState<Lang>(() =>
    readStored(STORAGE_KEY.lang, ['zh', 'en'] as const, 'zh'),
  );

  // 主题写入 <html data-theme>，CSS 变量随之切换
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(STORAGE_KEY.theme, theme);
    } catch {
      // 忽略持久化失败
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');
    try {
      localStorage.setItem(STORAGE_KEY.lang, lang);
    } catch {
      // 忽略持久化失败
    }
  }, [lang]);

  const t = useCallback<Translate>(
    (key, vars) => {
      // 英文缺词时回退中文，保证界面不会出现 key 本身
      const text = DICTS[lang][key] ?? DICTS.zh[key] ?? key;
      if (!vars) return text;
      return text.replace(/\{(\w+)\}/g, (_, name: string) =>
        vars[name] === undefined ? `{${name}}` : String(vars[name]),
      );
    },
    [lang],
  );

  const value = useMemo<SettingsValue>(
    () => ({ theme, lang, setTheme: setThemeState, setLang: setLangState, t }),
    [theme, lang, t],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings 必须在 SettingsProvider 内使用');
  return ctx;
}
