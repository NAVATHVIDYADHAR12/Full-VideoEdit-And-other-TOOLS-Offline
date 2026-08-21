#!/usr/bin/env python3
# =============================================================================
#  prepare_frames.py
#  Turns a folder of unzipped .jpg frames into a lean, correctly named
#  sequence that hero-scroll.js can play.
#
#  HOW TO USE
#    1. Unzip your frames somewhere (the ZIP the frame extractor gives you).
#    2. Fill in SOURCE_FOLDER below.
#    3. Run:  python prepare_frames.py
#    4. Copy the line it prints at the end into hero-scroll.js
#
#  NEEDS:  pip install pillow
# =============================================================================


# =============================================================================
#                          >>>  EDIT THIS BLOCK  <<<
# =============================================================================

# ---------------------------------------------------------------------------
#  1. WHERE YOUR UNZIPPED .JPG FILES ARE
#
#     Put the folder name (or full path) between the quotes.
#     Windows users: use forward slashes, or put an r in front like r"C:\...".
#
#     Examples that all work:
#         SOURCE_FOLDER = "my_frames"
#         SOURCE_FOLDER = "C:/Users/me/Downloads/my_frames"
#         SOURCE_FOLDER = r"C:\Users\me\Downloads\my_frames"
# ---------------------------------------------------------------------------
SOURCE_FOLDER = "PUT_YOUR_UNZIPPED_FRAMES_FOLDER_NAME_HERE"


# ---------------------------------------------------------------------------
#  2. WHERE THE FINISHED FRAMES SHOULD GO
#     This must match `folder` in hero-scroll.js. Leave it unless you moved it.
# ---------------------------------------------------------------------------
OUTPUT_FOLDER = "assets/hero"


# ---------------------------------------------------------------------------
#  3. HOW MANY FRAMES THE HERO SHOULD USE
#     60-90 is the sweet spot. Fewer looks steppy, more just costs download.
#     They are sampled evenly across your whole clip, never just the start.
# ---------------------------------------------------------------------------
FRAME_COUNT = 80


# ---------------------------------------------------------------------------
#  4. SIZE AND COMPRESSION
#     900 wide at quality 64 gives about 3-4 MB for 80 frames, which looks
#     sharp behind text. Raise QUALITY if it looks soft; lower it if the
#     script warns you the folder is too heavy.
# ---------------------------------------------------------------------------
WIDTH = 900
QUALITY = 64

# =============================================================================
#                     >>>  STOP EDITING HERE  <<<
# =============================================================================


import os
import re
import sys

SIZE_BUDGET_MB = 5.0


def die(message, hint=None):
    print("\n  ERROR: " + message)
    if hint:
        print("  " + hint)
    print()
    sys.exit(1)


def natural_key(name):
    """Sort frame_2 before frame_10, which a plain sort gets wrong."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', name)]


def main():
    # ---- check the settings before doing any work -------------------------
    if SOURCE_FOLDER.startswith("PUT_YOUR"):
        die("You have not set SOURCE_FOLDER yet.",
            "Open this file and put your unzipped frames folder in step 1.")

    if not os.path.isdir(SOURCE_FOLDER):
        die('Cannot find the folder "%s".' % SOURCE_FOLDER,
            "Check the spelling, or paste the full path instead.")

    try:
        from PIL import Image
    except ImportError:
        die("Pillow is not installed, and it is needed to resize images.",
            "Run this first:   pip install pillow")

    # ---- collect the frames ----------------------------------------------
    files = [f for f in os.listdir(SOURCE_FOLDER)
             if f.lower().endswith((".jpg", ".jpeg", ".png"))]
    files.sort(key=natural_key)

    if not files:
        die('No .jpg, .jpeg or .png files found in "%s".' % SOURCE_FOLDER,
            "Did the ZIP extract into a sub-folder? Point SOURCE_FOLDER at that.")

    total = len(files)
    print("\n  Found %d image(s) in %s" % (total, SOURCE_FOLDER))

    want = min(FRAME_COUNT, total)
    if want < FRAME_COUNT:
        print("  Only %d available, so using all of them." % want)

    os.makedirs(OUTPUT_FOLDER, exist_ok=True)

    # ---- clear any previous run, by exact name only -----------------------
    # Never wildcard-delete: this folder may hold files that are not ours.
    removed = 0
    for i in range(1, 1000):
        old = os.path.join(OUTPUT_FOLDER, "f%03d.jpg" % i)
        if os.path.exists(old):
            os.remove(old)
            removed += 1
        elif i > want:
            break
    if removed:
        print("  Cleared %d frame(s) from a previous run." % removed)

    # ---- sample evenly across the WHOLE clip ------------------------------
    # Taking the first N would give you the opening second in slow motion.
    print("  Writing %d frame(s) at %dpx wide, quality %d ...\n" % (want, WIDTH, QUALITY))

    written = 0
    for k in range(want):
        index = round(k * (total - 1) / (want - 1)) if want > 1 else 0
        src = os.path.join(SOURCE_FOLDER, files[index])

        try:
            img = Image.open(src)
            img = img.convert("RGB")                    # drop alpha; JPEG has none

            height = round(img.height * WIDTH / img.width)
            if height % 2:                              # keep it even, tidier scaling
                height += 1
            img = img.resize((WIDTH, height), Image.LANCZOS)

            out = os.path.join(OUTPUT_FOLDER, "f%03d.jpg" % (k + 1))
            img.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True)
            written += 1
        except Exception as exc:                         # one bad frame is not fatal
            print("    skipped %s (%s)" % (files[index], exc))

        if (k + 1) % 10 == 0 or k == want - 1:
            print("    %d / %d" % (k + 1, want))

    if written == 0:
        die("No frames could be written.", "Are the source files real images?")

    # ---- report ------------------------------------------------------------
    size_bytes = sum(
        os.path.getsize(os.path.join(OUTPUT_FOLDER, f))
        for f in os.listdir(OUTPUT_FOLDER) if f.startswith("f") and f.endswith(".jpg")
    )
    size_mb = size_bytes / (1024 * 1024)

    print("\n  " + "-" * 62)
    print("  Done.  %d frames -> %s" % (written, OUTPUT_FOLDER))
    print("  Total size: %.1f MB  (%.0f KB each)" % (size_mb, size_bytes / written / 1024))

    if size_mb > SIZE_BUDGET_MB:
        print("\n  WARNING: that is heavier than %.0f MB, which visitors will feel." % SIZE_BUDGET_MB)
        print("           Lower QUALITY to about %d, or drop FRAME_COUNT to 60." %
              max(45, QUALITY - 12))
    else:
        print("  Comfortably within the %.0f MB budget." % SIZE_BUDGET_MB)

    print("\n  NOW PUT THIS IN hero-scroll.js:")
    print("      count : %d," % written)
    print("      folder: '%s'," % OUTPUT_FOLDER.replace("\\", "/"))
    print("  " + "-" * 62 + "\n")


if __name__ == "__main__":
    main()
