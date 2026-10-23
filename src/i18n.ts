import type { MemoryRecord } from './core.js';

export const locales = ['en', 'zh-CN', 'ja', 'es'] as const;
export type Locale = typeof locales[number];
export const languageNames: Record<Locale, string> = { en: 'English', 'zh-CN': '简体中文', ja: '日本語', es: 'Español' };

interface Messages {
  personalMemory: string; allMemories: string; recordTypes: string; databaseConnected: string; vault: string;
  eyebrow: string; headline: string; introduction: string; addMemory: string; search: string; searchPlaceholder: string;
  type: string; allTypes: string; from: string; to: string; searchResults: string; timeline: string; shown: string;
  imported: string; restricted: string; openRecord: string; nextPage: string; emptyTitle: string; emptyBody: string;
  captureEyebrow: string; title: string; titlePlaceholder: string; date: string; notes: string; notesPlaceholder: string;
  attributes: string; expenseHelp: string; saveMemory: string; sources: string; sourceDescription: string;
  checkSetup: string; signInHelp: string; footer: string; revision: string; language: string; apply: string;
  validationNotice: string; invalidAttributes: string; saveFailed: string; transportConnected: string;
  enabled: string; disabled: string; needs: string; noConnections: string; statusFailed: string;
  loopbackOnly: string; crossOrigin: string; jsonRequired: string; revisionRequired: string; conflict: string;
  notFound: string; invalidInput: string; invalidJson: string; tooLarge: string; operationFailed: string; indexFailed: string;
  types: Record<MemoryRecord['type'], string>;
}

export const messages: Record<Locale, Messages> = {
  en: {
    personalMemory: 'PERSONAL MEMORY', allMemories: 'All memories', recordTypes: 'Record types', databaseConnected: 'connected', vault: 'Markdown vault',
    eyebrow: 'A PLACE FOR YOUR EVERYDAY', headline: 'Your memory, in your hands.', introduction: 'Capture a moment. Find a connection. Keep the original.',
    addMemory: 'Add memory', search: 'Search', searchPlaceholder: 'Find a meal, thought, or plan…', type: 'Type', allTypes: 'All types', from: 'From', to: 'To',
    searchResults: 'Search results', timeline: 'Memory timeline', shown: 'shown', imported: 'Imported', restricted: 'Restricted', openRecord: 'Open record', nextPage: 'Next page',
    emptyTitle: 'Start with one small moment.', emptyBody: 'Write about your day, log a meal, or save a plan. Your records stay in Markdown and are indexed locally.',
    captureEyebrow: 'MAKE A LITTLE SPACE', title: 'Title', titlePlaceholder: 'What would you like to remember?', date: 'Date', notes: 'Notes', notesPlaceholder: 'Write freely. Markdown is welcome.',
    attributes: 'Structured details (JSON)', expenseHelp: 'Expenses require integer amount_minor and a three-letter currency.', saveMemory: 'Save memory', sources: 'Connected sources',
    sourceDescription: 'Notion and Google Calendar connect through MCP.', checkSetup: 'Check setup', signInHelp: 'Complete sign-in from the CLI. Imports preview before saving.',
    footer: 'Your records. Your context. Portable by design.', revision: 'Revision', language: 'Language', apply: 'Apply',
    validationNotice: '{count} vault file(s) need attention. Check the server log and rebuild after fixing them.', invalidAttributes: 'Structured details must be a valid JSON object.', saveFailed: 'Could not save the memory.',
    transportConnected: 'MCP connected; account access not verified', enabled: 'enabled; sign-in not verified', disabled: 'disabled', needs: 'needs',
    noConnections: 'Run npm run cli -- mcp:init to configure connections.', statusFailed: 'Could not read connection status.',
    loopbackOnly: 'Only loopback hosts are allowed.', crossOrigin: 'Cross-origin requests are forbidden.', jsonRequired: 'Use application/json.', revisionRequired: 'If-Match revision header is required.',
    conflict: 'The record or connection changed. Reload and check its current state.', notFound: 'Record or resource not found.', invalidInput: 'Please check the submitted fields.', invalidJson: 'Invalid JSON.',
    tooLarge: 'Request too large.', operationFailed: 'Operation failed. Check local configuration and server logs.', indexFailed: 'Markdown was saved but indexing failed. Rebuild before retrying.',
    types: { journal: 'Journal', event: 'Calendar', meal: 'Meals', exercise: 'Exercise', expense: 'Expenses', travel: 'Travel', profile: 'Profile', memory: 'Memories' },
  },
  'zh-CN': {
    personalMemory: '个人记忆', allMemories: '全部记录', recordTypes: '记录类型', databaseConnected: '已连接', vault: 'Markdown 数据目录',
    eyebrow: '为日常生活留一处空间', headline: '你的记忆，由你掌握。', introduction: '记录一个瞬间，发现一份关联，保留原始内容。',
    addMemory: '添加记录', search: '搜索', searchPlaceholder: '查找饮食、想法或计划…', type: '类型', allTypes: '全部类型', from: '开始日期', to: '结束日期',
    searchResults: '搜索结果', timeline: '记忆时间线', shown: '条记录', imported: '已导入', restricted: '受限', openRecord: '查看记录', nextPage: '下一页',
    emptyTitle: '从一个小小的瞬间开始。', emptyBody: '写下今天的感受，记录一餐，或保存一个计划。原始记录保存在 Markdown 中，并通过本地索引查询。',
    captureEyebrow: '为记忆留一点空间', title: '标题', titlePlaceholder: '你想记住什么？', date: '日期', notes: '正文', notesPlaceholder: '自由记录，支持 Markdown。',
    attributes: '结构化详情（JSON）', expenseHelp: '支出需要整数 amount_minor 和三位大写货币代码 currency。', saveMemory: '保存记录', sources: '外部数据源',
    sourceDescription: '通过 MCP 连接 Notion 和 Google 日历。', checkSetup: '检查连接', signInHelp: '在命令行完成授权。导入前会先预览。',
    footer: '你的记录，你的上下文，随时可以迁移。', revision: '修订版本', language: '界面语言', apply: '切换',
    validationNotice: '有 {count} 个记录文件需要修复。请查看服务日志，修复后重建索引。', invalidAttributes: '结构化详情必须是有效的 JSON 对象。', saveFailed: '无法保存记录。',
    transportConnected: 'MCP 已连接，账户访问尚未验证', enabled: '已启用，授权尚未验证', disabled: '未启用', needs: '需要',
    noConnections: '请运行 npm run cli -- mcp:init 配置连接。', statusFailed: '无法读取连接状态。',
    loopbackOnly: '仅允许本机地址访问。', crossOrigin: '不允许跨站请求。', jsonRequired: '请使用 application/json。', revisionRequired: '需要 If-Match 修订版本请求头。',
    conflict: '记录或连接状态已变化，请刷新并检查当前状态。', notFound: '未找到记录或资源。', invalidInput: '请检查提交的字段。', invalidJson: 'JSON 格式无效。',
    tooLarge: '请求内容过大。', operationFailed: '操作失败，请检查本地配置和服务日志。', indexFailed: 'Markdown 已保存，但索引失败。请先重建索引，再尝试操作。',
    types: { journal: '日记', event: '日历', meal: '饮食', exercise: '运动', expense: '支出', travel: '旅行', profile: '个人资料', memory: '长期记忆' },
  },
  ja: {
    personalMemory: 'パーソナルメモリー', allMemories: 'すべての記録', recordTypes: '記録の種類', databaseConnected: '接続済み', vault: 'Markdown 保管庫',
    eyebrow: '毎日のための場所', headline: 'あなたの記憶を、あなたの手に。', introduction: '日々を記録し、つながりを見つけ、原文を残す。',
    addMemory: '記録を追加', search: '検索', searchPlaceholder: '食事、考え、予定を検索…', type: '種類', allTypes: 'すべての種類', from: '開始日', to: '終了日',
    searchResults: '検索結果', timeline: '記録のタイムライン', shown: '件を表示', imported: 'インポート済み', restricted: 'アクセス制限あり', openRecord: '記録を開く', nextPage: '次のページ',
    emptyTitle: '小さな出来事から始めましょう。', emptyBody: '今日のこと、食事、これからの予定を残しましょう。記録は Markdown に保存され、ローカルで検索できます。',
    captureEyebrow: '記憶のための小さな余白', title: 'タイトル', titlePlaceholder: '何を覚えておきたいですか？', date: '日付', notes: '本文', notesPlaceholder: '自由に記録できます。Markdown に対応しています。',
    attributes: '構造化データ（JSON）', expenseHelp: '支出には整数の amount_minor と3文字の通貨コード currency が必要です。', saveMemory: '記録を保存', sources: '外部データソース',
    sourceDescription: 'MCP を通じて Notion と Google カレンダーに接続します。', checkSetup: '接続を確認', signInHelp: 'CLI で認証を完了してください。保存前にインポート内容を確認できます。',
    footer: 'あなたの記録と文脈を、持ち運べる形で。', revision: 'リビジョン', language: '表示言語', apply: '切り替え',
    validationNotice: '{count} 個のファイルを修正する必要があります。ログを確認し、修正後にインデックスを再構築してください。', invalidAttributes: '構造化データには有効な JSON オブジェクトを入力してください。', saveFailed: '記録を保存できませんでした。',
    transportConnected: 'MCP 接続済み・アカウント権限は未確認', enabled: '有効・認証は未確認', disabled: '無効', needs: '必要な設定',
    noConnections: 'npm run cli -- mcp:init を実行して接続を設定してください。', statusFailed: '接続状態を取得できませんでした。',
    loopbackOnly: 'ローカルホストからのみアクセスできます。', crossOrigin: 'クロスオリジンのリクエストは許可されていません。', jsonRequired: 'application/json を使用してください。', revisionRequired: 'If-Match リビジョンヘッダーが必要です。',
    conflict: '記録または接続の状態が変わりました。再読み込みして確認してください。', notFound: '記録またはリソースが見つかりません。', invalidInput: '入力項目を確認してください。', invalidJson: 'JSON の形式が無効です。',
    tooLarge: 'リクエストが大きすぎます。', operationFailed: '操作に失敗しました。設定とサーバーログを確認してください。', indexFailed: 'Markdown は保存されましたが、インデックスの更新に失敗しました。再試行する前に再構築してください。',
    types: { journal: '日記', event: 'カレンダー', meal: '食事', exercise: '運動', expense: '支出', travel: '旅行', profile: 'プロフィール', memory: '長期記憶' },
  },
  es: {
    personalMemory: 'MEMORIA PERSONAL', allMemories: 'Todos los registros', recordTypes: 'Tipos de registro', databaseConnected: 'conectado', vault: 'Archivo Markdown',
    eyebrow: 'UN ESPACIO PARA TU DÍA A DÍA', headline: 'Tu memoria, en tus manos.', introduction: 'Guarda un momento. Encuentra una conexión. Conserva el original.',
    addMemory: 'Añadir registro', search: 'Buscar', searchPlaceholder: 'Busca comidas, ideas o planes…', type: 'Tipo', allTypes: 'Todos los tipos', from: 'Desde', to: 'Hasta',
    searchResults: 'Resultados de búsqueda', timeline: 'Cronología de registros', shown: 'mostrados', imported: 'Importado', restricted: 'Restringido', openRecord: 'Abrir registro', nextPage: 'Página siguiente',
    emptyTitle: 'Empieza con un pequeño momento.', emptyBody: 'Escribe sobre tu día, registra una comida o guarda un plan. Tus registros se conservan en Markdown y se indexan localmente.',
    captureEyebrow: 'HAZ ESPACIO PARA RECORDAR', title: 'Título', titlePlaceholder: '¿Qué te gustaría recordar?', date: 'Fecha', notes: 'Notas', notesPlaceholder: 'Escribe libremente. Puedes usar Markdown.',
    attributes: 'Datos estructurados (JSON)', expenseHelp: 'Los gastos requieren amount_minor entero y currency de tres letras.', saveMemory: 'Guardar registro', sources: 'Fuentes conectadas',
    sourceDescription: 'Conecta Notion y Google Calendar mediante MCP.', checkSetup: 'Comprobar conexión', signInHelp: 'Completa la autorización desde la CLI. Revisa la importación antes de guardar.',
    footer: 'Tus registros. Tu contexto. Portátil desde el principio.', revision: 'Revisión', language: 'Idioma', apply: 'Aplicar',
    validationNotice: '{count} archivos necesitan atención. Consulta el registro del servidor y reconstruye el índice después de corregirlos.', invalidAttributes: 'Los datos estructurados deben ser un objeto JSON válido.', saveFailed: 'No se pudo guardar el registro.',
    transportConnected: 'MCP conectado; acceso a la cuenta sin verificar', enabled: 'habilitado; autorización sin verificar', disabled: 'deshabilitado', needs: 'requiere',
    noConnections: 'Ejecuta npm run cli -- mcp:init para configurar las conexiones.', statusFailed: 'No se pudo consultar el estado de la conexión.',
    loopbackOnly: 'Solo se permiten direcciones locales.', crossOrigin: 'No se permiten solicitudes de otros orígenes.', jsonRequired: 'Usa application/json.', revisionRequired: 'Se requiere la cabecera de revisión If-Match.',
    conflict: 'El registro o la conexión ha cambiado. Recarga y comprueba su estado.', notFound: 'No se encontró el registro o recurso.', invalidInput: 'Comprueba los campos enviados.', invalidJson: 'JSON no válido.',
    tooLarge: 'La solicitud es demasiado grande.', operationFailed: 'La operación ha fallado. Comprueba la configuración y los registros del servidor.', indexFailed: 'Se guardó el Markdown, pero falló la indexación. Reconstruye el índice antes de reintentar.',
    types: { journal: 'Diario', event: 'Calendario', meal: 'Comidas', exercise: 'Ejercicio', expense: 'Gastos', travel: 'Viajes', profile: 'Perfil', memory: 'Memoria a largo plazo' },
  },
};

function supported(value?: string): Locale | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-hans') return 'zh-CN';
  if (normalized === 'ja' || normalized?.startsWith('ja-')) return 'ja';
  if (normalized === 'es' || normalized?.startsWith('es-')) return 'es';
  if (normalized === 'en' || normalized?.startsWith('en-')) return 'en';
}

export function resolveLocale(query: unknown, cookie = '', acceptLanguage = ''): Locale {
  const explicit = typeof query === 'string' ? supported(query) : undefined;
  if (explicit) return explicit;
  const saved = supported(cookie.split(';').map(part => part.trim()).find(part => part.startsWith('openloci_lang='))?.slice('openloci_lang='.length));
  if (saved) return saved;
  const choices = acceptLanguage.split(',').map((item, index) => {
    const [language, ...parameters] = item.split(';');
    const quality = parameters.find(value => value.trim().startsWith('q='));
    return { locale: supported(language), quality: quality ? Number(quality.trim().slice(2)) : 1, index };
  }).filter(item => item.locale && item.quality > 0 && item.quality <= 1).sort((a, b) => b.quality - a.quality || a.index - b.index);
  return choices[0]?.locale || 'en';
}

export function displayDate(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
