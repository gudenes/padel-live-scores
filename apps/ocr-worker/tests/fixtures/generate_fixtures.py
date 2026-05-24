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


if __name__ == "__main__":
    generate_full_frame()
