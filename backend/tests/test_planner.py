"""Segment planner tiles byte ranges exactly."""
from app.api.mux import plan_segments, SEGMENT_BYTES


def test_empty_total():
    assert plan_segments(0) == []


def test_single_small():
    assert plan_segments(100) == [(0, 99)]


def test_exact_multiple():
    segs = plan_segments(2 * SEGMENT_BYTES)
    assert segs == [(0, SEGMENT_BYTES - 1),
                    (SEGMENT_BYTES, 2 * SEGMENT_BYTES - 1)]


def test_tiles_exactly_with_clipped_tail():
    total = 3 * SEGMENT_BYTES + 123
    segs = plan_segments(total)
    assert len(segs) == 4
    assert segs[0][0] == 0
    assert segs[-1][1] == total - 1
    covered = sum(e - s + 1 for s, e in segs)
    assert covered == total
    for (s1, e1), (s2, e2) in zip(segs, segs[1:]):
        assert e1 + 1 == s2  # contiguous, no gaps or overlaps
