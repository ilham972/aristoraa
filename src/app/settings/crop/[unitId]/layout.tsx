import type { Viewport } from 'next';

// Crop route opts OUT of the app-wide pinch-zoom lock. The root layout sets
// `userScalable: false, maximumScale: 1` which keeps the rest of the app
// from accidental zoom on tap. Here we want the opposite: in Adjust mode
// the user inspects textbook scans by 2-finger pinching the page natively.
// `touch-action: none` on the image while drawing in Crop mode still blocks
// the browser pinch on that element, so this opt-in only lights up where
// the page lets gestures through (Adjust / Resize / Delete tools).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function CropLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
