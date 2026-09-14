import React from "react";

export const YoutubeIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

export const InstagramIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);

export const XIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export const TikTokIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.78 4.54 6.27 6.27 0 0 0 1.93-4.53V8.89a8.28 8.28 0 0 0 4.88 1.58V7.02a4.84 4.84 0 0 1-.72-.33Z" />
  </svg>
);

export const PinterestIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 0a12 12 0 0 0-4.37 23.18c-.06-.99-.12-2.52.02-3.6.14-1.07.95-3.95.95-3.95s-.24-.48-.24-1.2c0-1.12.65-1.96 1.46-1.96.69 0 1.02.52 1.02 1.14 0 .69-.44 1.73-.67 2.69-.19.8.4 1.46 1.19 1.46 1.43 0 2.53-1.51 2.53-3.68 0-1.93-1.38-3.27-3.36-3.27-2.45 0-3.89 1.84-3.89 3.74 0 .74.29 1.54.64 1.97.07.09.08.16.06.25-.07.28-.22.88-.25 1-.04.16-.13.2-.3.12-1.13-.53-1.84-2.18-1.84-3.51 0-2.86 2.08-5.48 5.99-5.48 3.14 0 5.58 2.24 5.58 5.23 0 3.12-1.97 5.64-4.7 5.64-.92 0-1.78-.48-2.08-1.04l-.57 2.16c-.2.79-.76 1.78-1.13 2.39A12 12 0 1 0 12 0z" />
  </svg>
);
