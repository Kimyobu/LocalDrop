import os

# Path to the folder containing the files
folder_path = "./IM"

# Get all files in the folder (sorted for consistent numbering)
files = sorted(os.listdir(folder_path))

# Counter starting at 1
counter = 1

for filename in files:
    old_path = os.path.join(folder_path, filename)

    # Skip directories
    if not os.path.isfile(old_path):
        continue

    # New filename with 5-digit numbering
    new_filename = f"Image Holder_{counter:05d}.jpg"
    new_path = os.path.join(folder_path, new_filename)

    os.rename(old_path, new_path)
    counter += 1
