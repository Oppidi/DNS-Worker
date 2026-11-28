import React, { useEffect, useRef, useState } from "react";

export interface UseSidebarSwipeGesturesParams {
  isMobile: boolean;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
}

export interface UseSidebarSwipeGesturesResult {
  dragOffset: number | null;
  dragOpenOffset: number | null;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  handleTouchEnd: () => void;
  handleTouchCancel: () => void;
}

/**
 * Handles mobile sidebar drawer swipe-to-close gestures, left-edge swipe-to-open gestures,
 * and Escape-key dismissal.
 */
export function useSidebarSwipeGestures({
  isMobile,
  isSidebarOpen,
  setIsSidebarOpen,
}: UseSidebarSwipeGesturesParams): UseSidebarSwipeGesturesResult {
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const [dragOpenOffset, setDragOpenOffset] = useState<number | null>(null);

  useEffect(() => {
    if (!isSidebarOpen) {
      setDragOffset(null);
      touchStartRef.current = null;
    }
  }, [isSidebarOpen]);

  const handleTouchStart = (e: React.TouchEvent): void => {
    if (!isMobile || !isSidebarOpen) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  };

  const handleTouchMove = (e: React.TouchEvent): void => {
    if (!isMobile || !isSidebarOpen || !touchStartRef.current) return;
    const touch = e.touches[0];
    const diffX = touch.clientX - touchStartRef.current.x;
    const diffY = touch.clientY - touchStartRef.current.y;

    if (diffX < 0 && Math.abs(diffX) > Math.abs(diffY)) {
      setDragOffset(Math.min(0, diffX));
    }
  };

  const handleTouchEnd = (): void => {
    if (!touchStartRef.current) return;
    const duration = Date.now() - touchStartRef.current.time;
    const offset = dragOffset ?? 0;

    if (offset < -50 || (duration < 300 && offset < -20)) {
      setIsSidebarOpen(false);
    }
    setDragOffset(null);
    touchStartRef.current = null;
  };

  const handleTouchCancel = (): void => {
    setDragOffset(null);
    touchStartRef.current = null;
  };

  useEffect(() => {
    if (!isMobile || isSidebarOpen) {
      setDragOpenOffset(null);
      return;
    }

    let startTouch: { x: number; y: number; time: number } | null = null;
    let isSwiping = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (touch.clientX <= 35) {
        startTouch = { x: touch.clientX, y: touch.clientY, time: Date.now() };
        isSwiping = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!startTouch) return;
      const touch = e.touches[0];
      const diffX = touch.clientX - startTouch.x;
      const diffY = touch.clientY - startTouch.y;

      if (!isSwiping) {
        if (diffX > 8 && Math.abs(diffX) > Math.abs(diffY) * 1.2) {
          isSwiping = true;
        } else if (Math.abs(diffY) > 10) {
          startTouch = null;
          return;
        }
      }

      if (isSwiping && diffX > 0) {
        setDragOpenOffset(Math.min(0, -256 + diffX));
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!startTouch) return;
      if (isSwiping) {
        const touch = e.changedTouches[0];
        const diffX = touch.clientX - startTouch.x;
        const duration = Date.now() - startTouch.time;
        if (diffX > 70 || (duration < 300 && diffX > 25)) {
          setIsSidebarOpen(true);
        }
      }
      startTouch = null;
      isSwiping = false;
      setDragOpenOffset(null);
    };

    const onTouchCancel = () => {
      startTouch = null;
      isSwiping = false;
      setDragOpenOffset(null);
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [isMobile, isSidebarOpen, setIsSidebarOpen]);

  useEffect(() => {
    if (!isMobile || !isSidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, isSidebarOpen, setIsSidebarOpen]);

  return {
    dragOffset,
    dragOpenOffset,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
  };
}
