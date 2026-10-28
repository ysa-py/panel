/**
 * Gozargah — panel UI composer (complete HTML document).
 */

import { PANEL_CSS } from './styles';
import { panelBody, emblemSvg } from './page';
import { LOGO_BRAND_B64, LOGO_FAV_B64 } from '../assets/logo';
import { VERSION } from '../config';

export interface PanelData {
  panelPath: string;
  dbOk: boolean;
  isDefaultPassword: boolean;
  version?: string;
  lang?: string;
}

export function panelHtml(d: PanelData): string {
  const version = d.version ?? VERSION;
  const body = panelBody({
    panelPath: d.panelPath,
    dbOk: d.dbOk,
    isDefaultPassword: d.isDefaultPassword,
    version,
    lang: d.lang ?? 'fa',
    logo: LOGO_BRAND_B64,
    favicon: LOGO_FAV_B64,
  });
  return (
    '<!DOCTYPE html><html lang="fa" dir="rtl"><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    '<meta name="robots" content="noindex, nofollow">' +
    '<meta name="theme-color" content="#050816">' +
    '<title>NYX · AETHERCORE EDGE</title>' +
    '<link rel="icon" href="' + LOGO_FAV_B64 + '">' +
    '<style>' + PANEL_CSS + '</style>' +
    '</head><body data-view="login">' + body + '</body></html>'
  );
}

export { emblemSvg };
