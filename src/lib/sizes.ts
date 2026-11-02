// The App Store screenshot sizes this service renders, in portrait pixels, from Apple's screenshot specifications:
// https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
//
// Apple requires the 6.3-inch iPhone size ("Dynamic Island, medium") for every iPhone app, and the 13-inch iPad size
// for apps that run on iPad. The 6.9-inch size is the largest, and App Store Connect scales it down for other
// devices, so the default set is 6.9-inch plus 6.3-inch.

export interface StoreSize {
  id: SizeId;
  label: string;
  width: number;
  height: number;
  /** The kind of device the screenshots in this slot show. */
  device: "phone" | "tablet";
}

export const SIZE_IDS = ["iphone-6.9", "iphone-6.5", "iphone-6.3", "iphone-5.5", "ipad-13"] as const;
export type SizeId = (typeof SIZE_IDS)[number];

export const SIZES: Record<SizeId, StoreSize> = {
  "iphone-6.9": { id: "iphone-6.9", label: 'iPhone 6.9"', width: 1320, height: 2868, device: "phone" },
  "iphone-6.5": { id: "iphone-6.5", label: 'iPhone 6.5"', width: 1284, height: 2778, device: "phone" },
  "iphone-6.3": { id: "iphone-6.3", label: 'iPhone 6.3"', width: 1206, height: 2622, device: "phone" },
  "iphone-5.5": { id: "iphone-5.5", label: 'iPhone 5.5"', width: 1242, height: 2208, device: "phone" },
  "ipad-13": { id: "ipad-13", label: 'iPad 13"', width: 2064, height: 2752, device: "tablet" },
};

export const DEFAULT_SIZES: SizeId[] = ["iphone-6.9", "iphone-6.3"];
