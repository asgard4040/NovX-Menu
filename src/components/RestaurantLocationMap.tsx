import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Point = { latitude: number; longitude: number };

export default function RestaurantLocationMap({ point, radius, selecting, onSelect }: {
  point: Point | null;
  radius: number;
  selecting: boolean;
  onSelect: (point: Point) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onSelectRef = useRef(onSelect);
  const selectingRef = useRef(selecting);
  onSelectRef.current = onSelect;
  selectingRef.current = selecting;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false, zoomControl: true });
    map.setView([33.2232, 43.6793], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(map);
    map.on('click', event => {
      if (selectingRef.current) onSelectRef.current({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    });
    mapRef.current = map;
    const frame = requestAnimationFrame(() => map.invalidateSize());
    return () => { cancelAnimationFrame(frame); map.remove(); mapRef.current = null; markerRef.current = null; circleRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().style.cursor = selecting ? 'crosshair' : '';
    if (!point) {
      markerRef.current?.remove(); markerRef.current = null;
      circleRef.current?.remove(); circleRef.current = null;
      return;
    }
    const center = L.latLng(point.latitude, point.longitude);
    if (markerRef.current) markerRef.current.setLatLng(center);
    else markerRef.current = L.circleMarker(center, { radius: 9, weight: 3, color: '#fff', fillColor: '#d7a34a', fillOpacity: 1, interactive: false }).addTo(map);
    if (circleRef.current) circleRef.current.setLatLng(center).setRadius(radius);
    else circleRef.current = L.circle(center, { radius, color: '#0f766e', weight: 2, fillColor: '#14b8a6', fillOpacity: 0.14, interactive: false }).addTo(map);
    map.fitBounds(circleRef.current.getBounds(), { padding: [24, 24], maxZoom: 16, animate: false });
  }, [point?.latitude, point?.longitude, radius]);

  return <div ref={containerRef} className="h-72 w-full rounded-2xl sm:h-80" role="application" aria-label="Restaurant location map" />;
}
