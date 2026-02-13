export type DeviceInfo = {
  deviceModel: string;
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  browserName: string;
  browserVersion: string;
  osName: string;
  osVersion: string;
  screenResolution: string;
  timeZone: string;
  userAgent: string;
  platform: string;
};

function safeString(v: unknown, fallback = 'unknown') {
  return typeof v === 'string' && v.trim().length > 0 ? v : fallback;
}

function parseBrowserFromUA(ua: string) {
  const s = ua;
  const match = (re: RegExp) => re.exec(s);

  const edge = match(/Edg\/([\d.]+)/);
  if (edge) return { browserName: 'Edge', browserVersion: edge[1] };

  const opera = match(/OPR\/([\d.]+)/) || match(/Opera\/([\d.]+)/);
  if (opera) return { browserName: 'Opera', browserVersion: opera[1] };

  const firefox = match(/Firefox\/([\d.]+)/);
  if (firefox) return { browserName: 'Firefox', browserVersion: firefox[1] };

  const chrome = match(/Chrome\/([\d.]+)/);
  if (chrome) return { browserName: 'Chrome', browserVersion: chrome[1] };

  const safari = match(/Version\/([\d.]+).*Safari/);
  if (safari) return { browserName: 'Safari', browserVersion: safari[1] };

  return { browserName: 'Browser', browserVersion: '' };
}

function parseOSFromUA(ua: string) {
  const s = ua;
  const match = (re: RegExp) => re.exec(s);

  const android = match(/Android\s+([\d.]+)/);
  if (android) return { osName: 'Android', osVersion: android[1] };

  const ios = match(/(iPhone|iPad|iPod).*OS\s+([\d_]+)/);
  if (ios) return { osName: 'iOS', osVersion: ios[2].replace(/_/g, '.') };

  const mac = match(/Mac OS X\s+([\d_]+)/);
  if (mac) return { osName: 'macOS', osVersion: mac[1].replace(/_/g, '.') };

  const win = match(/Windows NT\s+([\d.]+)/);
  if (win) return { osName: 'Windows', osVersion: win[1] };

  const linux = match(/Linux/);
  if (linux) return { osName: 'Linux', osVersion: '' };

  return { osName: 'unknown', osVersion: '' };
}

function parseDeviceModelFromUA(ua: string) {
  const s = ua;

  if (/iPad/.test(s)) return 'iPad';
  if (/iPhone/.test(s)) return 'iPhone';
  if (/iPod/.test(s)) return 'iPod';

  const androidModel =
    /Android.+;\s*([^;]+)\s+Build\//.exec(s) ||
    /Android.+;\s*([^;]+)\)/.exec(s);
  if (androidModel?.[1]) return androidModel[1].trim();

  if (/Windows/.test(s)) return 'PC';
  if (/Macintosh/.test(s)) return 'Mac';
  if (/Linux/.test(s)) return 'Linux';

  return 'unknown';
}

function inferDeviceType(ua: string): DeviceInfo['deviceType'] {
  const s = ua.toLowerCase();
  if (s.includes('ipad') || s.includes('tablet')) return 'tablet';
  if (s.includes('mobi') || s.includes('iphone') || s.includes('android')) return 'mobile';
  if (s.includes('windows') || s.includes('macintosh') || s.includes('linux')) return 'desktop';
  return 'unknown';
}

let cached: DeviceInfo | null = null;

export async function getDeviceInfo(): Promise<DeviceInfo> {
  if (cached) return cached;

  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  const platform = typeof navigator !== 'undefined' ? (navigator as any).platform : 'unknown';
  const screenResolution =
    typeof window !== 'undefined' && window.screen
      ? `${window.screen.width}x${window.screen.height}`
      : 'unknown';
  const timeZone =
    typeof Intl !== 'undefined' && Intl.DateTimeFormat
      ? safeString(Intl.DateTimeFormat().resolvedOptions().timeZone, 'unknown')
      : 'unknown';

  let deviceModel = parseDeviceModelFromUA(userAgent);
  let deviceType = inferDeviceType(userAgent);
  let { browserName, browserVersion } = parseBrowserFromUA(userAgent);
  let { osName, osVersion } = parseOSFromUA(userAgent);

  const uaData = typeof navigator !== 'undefined' ? (navigator as any).userAgentData : null;
  if (uaData?.getHighEntropyValues) {
    try {
      const high = await uaData.getHighEntropyValues([
        'model',
        'platform',
        'platformVersion',
        'uaFullVersion',
        'fullVersionList'
      ]);

      deviceModel = safeString(high?.model, deviceModel);
      osName = safeString(high?.platform, osName);
      osVersion = safeString(high?.platformVersion, osVersion);

      const fullList: Array<{ brand: string; version: string }> = Array.isArray(high?.fullVersionList)
        ? high.fullVersionList
        : [];
      const pick = fullList.find((b) => b.brand && !/not.?a.?brand/i.test(b.brand)) || fullList[0];
      if (pick?.brand) {
        browserName = pick.brand;
        browserVersion = pick.version || browserVersion;
      } else if (high?.uaFullVersion) {
        browserVersion = safeString(high.uaFullVersion, browserVersion);
      }
    } catch {
    }
  }

  cached = {
    deviceModel: safeString(deviceModel),
    deviceType,
    browserName: safeString(browserName, 'Browser'),
    browserVersion: safeString(browserVersion, ''),
    osName: safeString(osName),
    osVersion: safeString(osVersion, ''),
    screenResolution: safeString(screenResolution),
    timeZone: safeString(timeZone),
    userAgent: safeString(userAgent),
    platform: safeString(platform)
  };

  return cached!;
}
