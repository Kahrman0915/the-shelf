/** Show mode (search and price check) is paper; everything else, bar settings, is midnight. */
export function isShowPath(pathname: string): boolean {
  return pathname === '/show' || pathname.startsWith('/price/');
}
