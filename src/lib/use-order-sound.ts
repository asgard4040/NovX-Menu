import { useEffect, useRef, useState } from 'react';
import type { Order } from '../types';
import { hasNewRelevantOrder, type SoundRole } from './order-sound-events';


export function useOrderSound(restaurantId: string, role: SoundRole) {
  const preferenceKey = `novx_order_sound_${role}_${restaurantId}`;
  const [enabled, setEnabled] = useState(() => localStorage.getItem(preferenceKey) !== 'off');
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const contextRef = useRef<AudioContext | null>(null);
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    seenRef.current = null;
    enabledRef.current = localStorage.getItem(preferenceKey) !== 'off';
    setEnabled(enabledRef.current);
    return () => { void contextRef.current?.close(); contextRef.current = null; };
  }, [preferenceKey]);

  const unlock = async () => {
    const AudioContextType = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextType) return;
    contextRef.current ||= new AudioContextType();
    if (contextRef.current.state === 'suspended') await contextRef.current.resume();
  };

  useEffect(() => {
    if (!enabled) return;
    const resume = () => { void unlock().catch(() => {}); };
    document.addEventListener('pointerdown', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
    return () => { document.removeEventListener('pointerdown', resume); document.removeEventListener('keydown', resume); };
  }, [enabled, preferenceKey]);

  const play = (force = false) => {
    const context = contextRef.current;
    if ((!enabledRef.current && !force) || !context || context.state !== 'running') return;
    const start = context.currentTime;
    [0, 0.2].forEach((delay) => {
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(role === 'kitchen' ? 660 : 780, start + delay);
      volume.gain.setValueAtTime(0.0001, start + delay);
      volume.gain.exponentialRampToValueAtTime(0.12, start + delay + 0.015);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.16);
      tone.connect(volume).connect(context.destination);
      tone.start(start + delay);
      tone.stop(start + delay + 0.17);
    });
  };

  const checkOrders = (orders: Order[]) => {
    if (hasNewRelevantOrder(seenRef.current, orders, role)) play();
    seenRef.current = new Set([...(seenRef.current || []), ...orders.map((order) => order.id)]);
  };

  const toggle = async () => {
    const next = !enabled;
    enabledRef.current = next;
    setEnabled(next);
    localStorage.setItem(preferenceKey, next ? 'on' : 'off');
    if (next) { await unlock(); play(true); }
  };

  return { enabled, toggle, checkOrders };
}
