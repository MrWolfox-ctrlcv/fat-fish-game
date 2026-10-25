/** Mount the small, non-blocking corner companion and its compact settings panel. */
export function createCornerCompanion({ container, trigger, panel, onOpen = () => {} }) {
  if (!container || !trigger || !panel) throw new TypeError("陪玩角落需要 container、trigger 和 panel");
  const closeButton = panel.querySelector(".companion-close");
  const setOpen = (open, { restoreFocus = false } = {}) => {
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) onOpen();
    else if (restoreFocus) trigger.focus();
  };
  const handleToggle = () => setOpen(panel.hidden);
  const handleClose = () => setOpen(false);
  const handleOutside = (event) => {
    if (!panel.hidden && !container.contains(event.target)) setOpen(false);
  };
  const handleKeydown = (event) => {
    if (event.key !== "Escape" || panel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false, { restoreFocus: true });
  };
  trigger.addEventListener("click", handleToggle);
  closeButton?.addEventListener("click", handleClose);
  document.addEventListener("pointerdown", handleOutside);
  document.addEventListener("keydown", handleKeydown, true);
  return {
    open() { setOpen(true); },
    close() { setOpen(false); },
    destroy() {
      trigger.removeEventListener("click", handleToggle);
      closeButton?.removeEventListener("click", handleClose);
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKeydown, true);
    },
  };
}
