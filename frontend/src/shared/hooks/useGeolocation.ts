import { useCallback, useRef } from 'react';
import type { GeoLocation } from '@/api';

/**
 * 浏览器定位（用于「当前位置天气」）
 *
 * 缓存 + 只尝试一次：避免每条消息都弹授权；用户拒绝后静默降级为不定位。
 */
export function useGeolocation() {
  const locationRef = useRef<GeoLocation | null>(null);
  const triedRef = useRef(false);
  const promiseRef = useRef<Promise<GeoLocation | null> | null>(null);

  const getLocation = useCallback((): Promise<GeoLocation | null> => {
    if (locationRef.current) return Promise.resolve(locationRef.current);
    if (triedRef.current || typeof navigator === 'undefined' || !navigator.geolocation) {
      return Promise.resolve(null);
    }
    if (!promiseRef.current) {
      triedRef.current = true;
      promiseRef.current = new Promise<GeoLocation | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            locationRef.current = loc;
            resolve(loc);
          },
          () => resolve(null), // 拒绝 / 超时 / 不可用：静默降级
          { timeout: 5000, maximumAge: 10 * 60 * 1000 },
        );
      });
    }
    return promiseRef.current;
  }, []);

  return getLocation;
}
