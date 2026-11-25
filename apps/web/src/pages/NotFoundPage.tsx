import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main id="main-content" className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 text-ink">
      <a className="skip-link" href="#main-content">
        跳到正文
      </a>
      <p className="text-[11px] font-medium tracking-[0.16em] text-mute uppercase">404</p>
      <h1 className="mt-3 text-[28px] font-semibold tracking-tight">没有这个页面</h1>
      <p className="mt-2 max-w-[36ch] text-center text-[13px] leading-6 text-mute">
        这个地址不属于墨问。返回当前对话。
      </p>
      <Link to="/" className="pressable btn btn-primary mt-6 w-fit">
        返回对话
      </Link>
    </main>
  );
}
