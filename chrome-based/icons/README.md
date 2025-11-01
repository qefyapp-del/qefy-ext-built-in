# Extension Icons

This directory contains the icon assets for the QEFY Chrome extension.

## Required Icon Sizes

You need to create the following PNG files:

- `icon16.png` - 16x16 pixels (used in extension toolbar and favicon)
- `icon32.png` - 32x32 pixels (used in extension management page)
- `icon48.png` - 48x48 pixels (used in extension management page)
- `icon128.png` - 128x128 pixels (used in Chrome Web Store and installation)

## Creating Icons

You can create these icons using any image editor (Photoshop, GIMP, Figma, etc.) or online tools like:

- [Favicon Generator](https://www.favicon-generator.org/)
- [Icon Generator](https://iconifier.net/)
- [Chrome Extension Icon Generator](https://chrome-extension-icon-generator.vercel.app/)

## Icon Guidelines

- Use PNG format for best quality
- Keep designs simple and recognizable at small sizes
- Use consistent branding colors
- Ensure good contrast for visibility
- Consider using a square design that works well when scaled

## Generating Icons

### Option 1: Python Script (Recommended)
```bash
python3 generate_icons.py
```

### Option 2: Shell Script (requires ImageMagick)
```bash
./generate_icons.sh
```

Both scripts will automatically resize `icon_base.png` to all required sizes.

## Current Status

✅ **Icons are ready!** - All required icon files have been generated from `icon_base.png`.

The extension will now:
1. Display your custom icon in the Chrome toolbar
2. Show your custom favicon in hijacked tabs  
3. Use your icon in the Chrome extensions management page

## Files Generated
- `icon16.png` (16x16px) - 551 bytes
- `icon32.png` (32x32px) - 963 bytes  
- `icon48.png` (48x48px) - 1368 bytes
- `icon128.png` (128x128px) - 3850 bytes
