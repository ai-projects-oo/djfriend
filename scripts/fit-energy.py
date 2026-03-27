#!/usr/bin/env python3
"""
Fits a linear regression from acoustic features → MixedInKey energy (1–10).
Input: features.csv produced by extract-features.ts

Usage:
  python3 scripts/fit-energy.py features.csv
"""
import sys
import csv
import math
import json

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 fit-energy.py features.csv", file=sys.stderr)
        sys.exit(1)

    rows = []
    with open(sys.argv[1]) as f:
        for row in csv.DictReader(f):
            try:
                rows.append({
                    'energy': int(row['energy']),
                    'onsetRate': float(row['onsetRate']),
                    'rms': float(row['rms']),
                    'dynamicComplexity': float(row['dynamicComplexity']),
                    'spectralCentroid': float(row['spectralCentroid']),
                    'hfc': float(row['hfc']),
                })
            except (ValueError, KeyError):
                continue

    print(f"Loaded {len(rows)} rows", file=sys.stderr)
    if len(rows) < 10:
        print("Not enough data", file=sys.stderr)
        sys.exit(1)

    # Print energy distribution
    from collections import Counter
    dist = Counter(r['energy'] for r in rows)
    print("Energy distribution:", dict(sorted(dist.items())), file=sys.stderr)

    # Feature names and raw values
    feature_names = ['onsetRate', 'rms', 'dynamicComplexity', 'spectralCentroid', 'hfc']

    # Print raw feature stats to understand ranges
    print("\nRaw feature stats:", file=sys.stderr)
    for fn in feature_names:
        vals = [r[fn] for r in rows]
        print(f"  {fn}: min={min(vals):.4f} max={max(vals):.4f} mean={sum(vals)/len(vals):.4f}", file=sys.stderr)

    # Transform features: log(rms), log1p(onsetRate), log1p(hfc), raw rest
    def transform(r):
        rms_db = 20 * math.log10(max(r['rms'], 1e-9))
        return [
            min(1.0, r['onsetRate'] / 15.0),          # onsetRate normalized
            max(0.0, min(1.0, 1 + rms_db / 55.0)),    # rms → 0–1 score
            r['dynamicComplexity'],
            r['spectralCentroid'] / 10000.0,           # normalize Hz
            math.log1p(r['hfc']) / 10.0,               # log-compress HFC
        ]

    X = [transform(r) for r in rows]
    y = [r['energy'] / 10.0 for r in rows]  # normalize to 0–1

    n = len(X)
    k = len(X[0])

    # Add bias term
    Xb = [xi + [1.0] for xi in X]

    # Normal equations: w = (X'X)^-1 X'y
    def mat_mul(A, B):
        rows_a, cols_a = len(A), len(A[0])
        cols_b = len(B[0])
        C = [[0.0]*cols_b for _ in range(rows_a)]
        for i in range(rows_a):
            for j in range(cols_b):
                for kk in range(cols_a):
                    C[i][j] += A[i][kk] * B[kk][j]
        return C

    def transpose(A):
        return [[A[i][j] for i in range(len(A))] for j in range(len(A[0]))]

    def mat_vec(A, v):
        return [sum(A[i][j]*v[j] for j in range(len(v))) for i in range(len(A))]

    def invert(M):
        n = len(M)
        aug = [M[i][:] + [1.0 if i==j else 0.0 for j in range(n)] for i in range(n)]
        for col in range(n):
            # Pivot
            pivot = max(range(col, n), key=lambda r: abs(aug[r][col]))
            aug[col], aug[pivot] = aug[pivot], aug[col]
            if abs(aug[col][col]) < 1e-12:
                continue
            scale = aug[col][col]
            aug[col] = [x/scale for x in aug[col]]
            for row in range(n):
                if row != col:
                    factor = aug[row][col]
                    aug[row] = [aug[row][j] - factor*aug[col][j] for j in range(2*n)]
        return [row[n:] for row in aug]

    Xt = transpose(Xb)
    XtX = mat_mul(Xt, Xb)
    Xty = mat_vec(Xt, y)

    # Ridge regularization (lambda=0.01) for stability
    lam = 0.01
    for i in range(k+1):
        XtX[i][i] += lam

    XtX_inv = invert(XtX)
    w = mat_vec(XtX_inv, Xty)

    # Predictions and R²
    preds = [max(0.1, min(1.0, sum(Xb[i][j]*w[j] for j in range(k+1)))) for i in range(n)]
    ss_res = sum((y[i]-preds[i])**2 for i in range(n))
    y_mean = sum(y)/n
    ss_tot = sum((yi-y_mean)**2 for yi in y)
    r2 = 1 - ss_res/ss_tot if ss_tot > 0 else 0

    print(f"\nR² = {r2:.4f}", file=sys.stderr)

    # Per-energy bucket error
    buckets = {}
    for i, r in enumerate(rows):
        e = r['energy']
        if e not in buckets:
            buckets[e] = []
        buckets[e].append(abs(y[i] - preds[i]) * 10)
    print("\nMean abs error per energy level:", file=sys.stderr)
    for e in sorted(buckets):
        errs = buckets[e]
        print(f"  energy {e}: mean={sum(errs)/len(errs):.2f}, n={len(errs)}", file=sys.stderr)

    # Print weights
    feat_labels = ['onsetNorm', 'rmsScore', 'dynamicComplexity', 'spectralCentroidNorm', 'hfcLog', 'bias']
    print("\nLearned weights:", file=sys.stderr)
    for label, wi in zip(feat_labels, w):
        print(f"  {label}: {wi:.6f}", file=sys.stderr)

    # Output TypeScript snippet
    print("\n// ── Paste into analyzer.ts energy section ──────────────────────")
    print("const onsetNorm = Math.min(1, onsetRate / 15);")
    print("const rmsScore = Math.max(0, Math.min(1, 1 + rmsDb / 55));")
    print("const dcNorm = dynamicComplexity;")
    print("const centNorm = spectralCentroid / 10000;")
    print("const hfcNorm = Math.log1p(hfc) / 10;")
    print(f"const energy = Math.max(0.1, Math.min(1.0,")
    print(f"  {w[0]:.6f} * onsetNorm +")
    print(f"  {w[1]:.6f} * rmsScore +")
    print(f"  {w[2]:.6f} * dcNorm +")
    print(f"  {w[3]:.6f} * centNorm +")
    print(f"  {w[4]:.6f} * hfcNorm +")
    print(f"  {w[5]:.6f}  // bias")
    print("));")
    print("const energyRounded = Math.round(energy * 1000) / 1000;")

if __name__ == '__main__':
    main()
