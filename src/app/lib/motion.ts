/* ============================================================
   兼容入口：早期落地页 / 登录页单独加载的「独立版动效引擎」。
   现已与 runtime.ts 的 mountMotion() 合并为全局单例（进度条、
   scroll 监听、IntersectionObserver 全程只建一次）。
   保留此导出，避免历史页面里的旧引用失效；新代码直接用 mountMotion。
   ============================================================ */
export { mountMotion as mountMotionStandalone } from './runtime';
