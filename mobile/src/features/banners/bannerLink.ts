import type { BannerLinkDto } from '@contracts/catalog';

export type BannerAction =
  | { kind: 'route'; href: string }
  | { kind: 'browser'; url: string }
  | { kind: 'none' };

/** Maps a banner link to a navigation action. Only these link types and https URLs are allowed; anything else does nothing. */
export function resolveBannerLink(link: BannerLinkDto | null | undefined): BannerAction {
  if (!link) return { kind: 'none' };
  const target = (link.target ?? '').trim();
  switch (link.type) {
    case 'product':
      return target ? { kind: 'route', href: `/product/${encodeURIComponent(target)}` } : { kind: 'none' };
    case 'category':
      return target ? { kind: 'route', href: `/catalog?category=${encodeURIComponent(target)}` } : { kind: 'none' };
    case 'flash':
      return { kind: 'route', href: '/flash-deals' };
    case 'smartbuy':
      return { kind: 'route', href: '/smartbuy-promo' };
    case 'url':
      return /^https:\/\/[^\s]+$/i.test(target) ? { kind: 'browser', url: target } : { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}
