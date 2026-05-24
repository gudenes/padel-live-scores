"""Generate synthetic test fixtures. Run once; output PNGs are committed."""
import cv2
import numpy as np


def generate_full_frame():
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    # Background: dark green padel court
    frame[:] = (30, 80, 30)
    # White scoreboard rectangle at bbox [50, 900, 600, 120]
    cv2.rectangle(frame, (50, 900), (650, 1020), (245, 245, 245), -1)
    cv2.putText(frame, "COELLO TAPIA  6  4  30", (60, 950),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(frame, "GALAN CHINGO  3  2  15", (60, 1000),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.imwrite("sample_full_frame.png", frame)


def generate_scoreboard():
    """High-contrast scoreboard crop suitable for OCR."""
    img = np.full((120, 600, 3), 245, dtype=np.uint8)
    cv2.putText(img, "COELLO TAPIA  6  4  30", (10, 50),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (10, 10, 10), 2)
    cv2.putText(img, "GALAN CHINGO  3  2  15", (10, 100),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (10, 10, 10), 2)
    cv2.imwrite("sample_scoreboard.png", img)


if __name__ == "__main__":
    generate_full_frame()
    generate_scoreboard()
