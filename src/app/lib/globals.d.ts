/**
 * 运行时挂到 window 的全局契约。
 * 骨架由 runtime.ts 注入，早期内联脚本与 legacy 控制器仍按全局名调用；
 * 以前没有声明，typecheck 会把这些正常调用报成 TS2339。
 */
export {};

declare global {
  interface Window {
    /** 公开页标记：WHOIS / 条款页 401 不应被踢去登录页 */
    MEOY_PUBLIC_PAGE?: boolean;
    /** runtime.ts 注入的工具集合，供内联 onclick 使用 */
    MeoyRuntime?: Record<string, any>;
    MeoyRenderAvatars?: (url: string) => void;
    MeoyRenderCatFaces?: () => void;
    MeoyCloud?: any;
    /** 主题切换器：不同页面版本暴露的方法集合不完全一致，保持开放 */
    MeoyTheme?: Record<string, any>;
    closeModal?: () => void;
    __TD_WIZARD_DONE?: boolean;
  }
}
