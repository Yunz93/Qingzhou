export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const element = document.createElement("textarea");
      element.value = text;
      element.setAttribute("readonly", "");
      element.style.position = "fixed";
      element.style.left = "-9999px";
      document.body.appendChild(element);
      element.select();
      const copied = document.execCommand("copy");
      element.remove();
      return copied;
    } catch {
      return false;
    }
  }
}
