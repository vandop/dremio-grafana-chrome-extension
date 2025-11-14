#!/usr/bin/env python3
"""
Simple script to create placeholder icons for the Chrome extension
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size, filename):
    # Create a new image with a blue background
    img = Image.new('RGBA', (size, size), (0, 123, 186, 255))
    draw = ImageDraw.Draw(img)

    # Draw a simple "U" for UUID
    try:
        # Try to use a system font
        font_size = max(size // 3, 12)
        font = ImageFont.truetype("/System/Library/Fonts/Arial.ttf", font_size)
    except:
        # Fallback to default font
        font = ImageFont.load_default()

    # Draw white "U" in center
    text = "U"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    x = (size - text_width) // 2
    y = (size - text_height) // 2

    draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)

    # Save the image
    img.save(filename, 'PNG')
    print(f"Created {filename} ({size}x{size})")

def main():
    # Create icons in different sizes
    sizes = [16, 32, 48, 128]

    for size in sizes:
        filename = f"icon{size}.png"
        create_icon(size, filename)

if __name__ == "__main__":
    main()