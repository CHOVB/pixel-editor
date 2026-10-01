"""
홍보 영상용 "AI 가 만든 것 같은" 고해상도 도트 그림 만들기
 - 20x20 버섯 캐릭터를 20배로 키우고, 색 얼룩(노이즈)과 경계 번짐을 넣습니다.
 - 결과: ai-mushroom.png (400x400)
"""
import random, struct, sys, zlib

ART = [
    "......kkkkkkkk......",
    "....kkrrrrrrrrkk....",
    "...krrrrwwrrrrrrk...",
    "..krrwwwwrrrrwwrrk..",
    ".krrrwwwrrrrrwwwrrk.",
    ".krrrrrrrrrrrrrwrrk.",
    "krrwwrrrrwwwrrrrrrrk",
    "krwwwwrrwwwwwrrrrddk",
    "krrwwrrrrwwwrrrrdddk",
    ".kddrrrrrrrrrrrdddk.",
    "..kkddddddddddddkk..",
    "....kkssssssssk.....",
    "....ksseesseeskk....",
    "....ksseesseessk....",
    "....kssssppssssk....",
    "....ksssssssssck....",
    ".....kccsssccck.....",
    "....kbbkccccckbbk...",
    "...kbbbbkkkkkbbbbk..",
    "....kkkk.....kkkk...",
]
PAL = {
    "k": (38, 24, 44), "r": (228, 59, 68), "w": (255, 240, 230), "d": (158, 40, 53),
    "s": (244, 214, 180), "e": (38, 24, 44), "p": (232, 120, 140), "c": (214, 170, 140),
    "b": (115, 62, 57), ".": (250, 250, 247),
}
S = 20
N = len(ART)
W = N * S
random.seed(7)

def cell(x, y):
    return PAL[ART[min(N - 1, max(0, y))][min(N - 1, max(0, x))]]

px = []
for y in range(W):
    for x in range(W):
        cx, cy = x // S, y // S
        c = cell(cx, cy)
        # 경계 1~2px 은 이웃 색과 섞어서 "AI 그림"처럼 번지게
        fx, fy = x % S, y % S
        if fx < 2 or fx >= S - 2 or fy < 2 or fy >= S - 2:
            nx = cx - 1 if fx < 2 else cx + 1 if fx >= S - 2 else cx
            ny = cy - 1 if fy < 2 else cy + 1 if fy >= S - 2 else cy
            o = cell(nx, ny)
            t = 0.3
            c = tuple(int(c[i] * (1 - t) + o[i] * t) for i in range(3))
        n = random.randint(-9, 9)
        px.append(tuple(max(0, min(255, v + n + random.randint(-3, 3))) for v in c) + (255,))

raw = b"".join(b"\x00" + b"".join(bytes(px[y * W + x]) for x in range(W)) for y in range(W))
def chunk(t, d):
    return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
out = sys.argv[1] if len(sys.argv) > 1 else "ai-mushroom.png"
open(out, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, W, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
print("wrote", out, W, "x", W)
