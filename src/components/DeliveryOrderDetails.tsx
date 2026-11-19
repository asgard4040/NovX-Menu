import type { Order } from "../types";
import { useLanguage } from "../lib/i18n";

export function DeliveryOrderDetails({ order }: { order: Order }) {
  const { language }=useLanguage();
  const delivery=order.deviceMetadata?.fulfillment==='delivery' ? order.deviceMetadata.delivery : null;
  if (!delivery) return null;
  const ar=language==='ar',address=delivery.address;
  const hasMap=typeof address?.latitude==='number' && typeof address.longitude==='number' &&
    address.latitude>=-90 && address.latitude<=90 && address.longitude>=-180 && address.longitude<=180;
  return <section className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-brand-primary" aria-label={ar?'تفاصيل التوصيل':'Delivery details'}>
    <p className="font-bold">{ar?'عنوان التوصيل':'Delivery address'}</p>
    <p dir="auto" className="break-words">{address?.details || [address?.city,address?.area].filter(Boolean).join('، ')}</p>
    {/^\+[1-9]\d{6,14}$/.test(delivery.contactPhone) && <p>{ar?'هاتف التوصيل: ':'Delivery phone: '}<a className="font-semibold underline" href={'tel:'+delivery.contactPhone}><bdi>{delivery.contactPhone}</bdi></a></p>}
    {typeof delivery.fee==='number' && Number.isFinite(delivery.fee) && <p>{ar?'رسوم التوصيل: ':'Delivery fee: '}{delivery.fee.toLocaleString()} {ar?'د.ع':'IQD'}</p>}
    {hasMap && <a className="inline-block underline" target="_blank" rel="noopener noreferrer" href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address.latitude+','+address.longitude)}>{ar?'فتح الموقع المرسل':'Open shared location'}</a>}
  </section>;
}
