import sys
from pathlib import Path

# Try to import Pillow (PIL). Provide a clear message if it's missing.
try:
    from PIL import Image, ImageOps
except ImportError as e:
    sys.stderr.write(
        "Pillow (PIL) is required. Install it with:\n"
        "    pip install pillow\n"
    )
    sys.exit(1)


TARGET_WIDTH = 512
TARGET_HEIGHT = 768


def resize_to_512x768(input_path: Path, output_path: Path) -> None:
    """Resize the input image to exactly 512x768 and save to output_path.

    Uses high-quality Lanczos resampling. Applies EXIF orientation so that images
    shot on phones keep correct orientation before resizing.
    """
    with Image.open(input_path) as im:
        # Respect EXIF orientation
        im = ImageOps.exif_transpose(im)

        # Pillow 9.1+ moved constants under Image.Resampling
        try:
            resample = Image.Resampling.LANCZOS  # type: ignore[attr-defined]
        except AttributeError:
            resample = Image.LANCZOS  # fallback for older Pillow versions

        resized = im.resize((TARGET_WIDTH, TARGET_HEIGHT), resample)

        # Create parent dirs for output if needed
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Preserve format by extension if possible
        save_kwargs = {}
        ext = output_path.suffix.lower()
        if ext in {".jpg", ".jpeg"}:
            save_kwargs["quality"] = 95
            save_kwargs["optimize"] = True
        elif ext == ".png":
            save_kwargs["optimize"] = True

        resized.save(output_path, **save_kwargs)


def build_default_output_path(input_path: Path) -> Path:
    stem = input_path.stem
    ext = input_path.suffix or ".jpg"
    return input_path.with_name(f"{stem}_{TARGET_WIDTH}x{TARGET_HEIGHT}{ext}")


def main(argv: list[str]) -> int:
    if len(argv) < 2 or len(argv) > 3:
        sys.stderr.write(
            "Usage: python r.py <input_image> [output_image]\n\n"
            f"Resizes the input image to {TARGET_WIDTH}x{TARGET_HEIGHT}.\n"
            "If output_image is omitted, a new file with a size suffix is created\n"
            "next to the input (e.g., photo_512x768.jpg).\n"
        )
        return 2

    input_path = Path(argv[1]).expanduser()
    if not input_path.exists():
        sys.stderr.write(f"Input file not found: {input_path}\n")
        return 2

    if len(argv) == 3:
        output_path = Path(argv[2]).expanduser()
    else:
        output_path = build_default_output_path(input_path)

    try:
        resize_to_512x768(input_path, output_path)
    except Exception as exc:
        sys.stderr.write(f"Error: {exc}\n")
        return 1

    print(f"Saved: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
