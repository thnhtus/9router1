"use client";

import { cn } from "cn";
import Button from "./Button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const sizes = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-lg", xl: "sm:max-w-xl", full: "sm:max-w-4xl" };

// showTrafficLights kept for API compatibility; shadcn close button replaces it
export default function Modal({ isOpen, onClose, title, children, footer, size = "md", closeOnOverlay = true, className }) {
  return (
    <Dialog open={!!isOpen} onOpenChange={(open) => !open && onClose?.()} disablePointerDismissal={!closeOnOverlay}>
      <DialogContent className={cn("gap-0 p-0", sizes[size], className)}>
        {title && (
          <DialogHeader className="border-b px-4 py-3 pr-10">
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
        )}
        <div className="custom-scrollbar max-h-[calc(85vh-100px)] overflow-y-auto p-4">{children}</div>
        {footer && <DialogFooter className="m-0">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmModal({ isOpen, onClose, onConfirm, title = "Confirm", message, confirmText = "Confirm", cancelText = "Cancel", variant = "danger", loading = false }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>{cancelText}</Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>{confirmText}</Button>
        </>
      }
    >
      <p className="text-muted-foreground">{message}</p>
    </Modal>
  );
}
