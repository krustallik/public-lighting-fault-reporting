#!/usr/bin/env python3
"""Offline EPSG:8353 to CRS84 helper for the fixed Košice source snapshot."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
from pathlib import Path
from typing import Any

EXPECTED_PYPROJ_VERSION = "3.7.2"
EXPECTED_PROJ_VERSION = "9.5.1"
EXPECTED_PIPELINE = (
    "+proj=pipeline +step +inv +proj=krovak +lat_0=49.5 +lon_0=24.8333333333333 "
    "+alpha=30.2881397527778 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel "
    "+step +proj=push +v_3 +step +proj=cart +ellps=bessel "
    "+step +proj=helmert +x=485.021 +y=169.465 +z=483.839 "
    "+rx=-7.786342 +ry=-4.397554 +rz=-4.102655 +s=0 "
    "+convention=coordinate_frame +step +inv +proj=cart +ellps=WGS84 "
    "+step +proj=pop +v_3 +step +proj=unitconvert +xy_in=rad +xy_out=deg"
)
EXPECTED_DATABASE_HASHES = {
    "linux-x86_64": "a25d85a2ebfc4584eba65186b7c41743b084ce5d391941cbb41c805947b77109",
    "windows-amd64": "47a7205d83ba6b7774b763f276ab57331f4dade2b2cfbcc0d486677e6543350b",
}


def fail() -> None:
    raise RuntimeError("Pinned offline EPSG:8368 transformation is unavailable")


def platform_key() -> str:
    machine = platform.machine().lower()
    if sys.platform == "win32" and machine in {"amd64", "x86_64"}:
        return "windows-amd64"
    if sys.platform.startswith("linux") and machine in {"x86_64", "amd64"}:
        return "linux-x86_64"
    fail()
    raise AssertionError("unreachable")


def contains_operation_8368(value: Any) -> bool:
    if isinstance(value, dict):
        identifier = value.get("id")
        if isinstance(identifier, dict):
            try:
                code = int(identifier.get("code"))
            except (TypeError, ValueError):
                code = -1
            if code == 8368 and "EPSG" in str(identifier.get("authority", "")):
                return True
        return any(contains_operation_8368(child) for child in value.values())
    if isinstance(value, list):
        return any(contains_operation_8368(child) for child in value)
    return False


def transform_coordinates(value: Any, transformer: Any) -> Any:
    if not isinstance(value, list) or not value:
        raise ValueError("Invalid coordinate structure")
    if isinstance(value[0], (int, float)):
        if len(value) != 2 or not all(isinstance(v, (int, float)) for v in value):
            raise ValueError("Expected two-dimensional source coordinates")
        longitude, latitude = transformer.transform(
            float(value[0]), float(value[1]), errcheck=True
        )
        if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
            raise ValueError("Transformed coordinate is outside CRS84 range")
        # PROJ's pinned 9.5.1 math libraries differ below 1e-13 degrees across
        # Windows/Linux. Quantize to 1e-10 degrees (about 0.01 mm) so the
        # checked artifact is byte-identical on both supported toolchains.
        return [round(longitude, 10), round(latitude, 10)]
    return [transform_coordinates(child, transformer) for child in value]


def main() -> None:
    if os.environ.get("PROJ_NETWORK", "").upper() != "OFF":
        fail()

    import pyproj
    from pyproj import CRS, datadir
    from pyproj.transformer import TransformerGroup

    if pyproj.__version__ != EXPECTED_PYPROJ_VERSION:
        fail()
    if pyproj.proj_version_str != EXPECTED_PROJ_VERSION:
        fail()

    key = platform_key()
    database = Path(datadir.get_data_dir()) / "proj.db"
    database_hash = hashlib.sha256(database.read_bytes()).hexdigest()
    if database_hash != EXPECTED_DATABASE_HASHES[key]:
        fail()

    group = TransformerGroup(
        CRS.from_epsg(8353),
        CRS.from_user_input("OGC:CRS84"),
        always_xy=True,
    )
    if not group.best_available or len(group.transformers) != 1 or group.unavailable_operations:
        fail()
    transformer = group.transformers[0]
    operation = transformer.to_json_dict()
    pipeline = transformer.to_proj4()
    if (
        not contains_operation_8368(operation)
        or transformer.accuracy != 1.0
        or pipeline != EXPECTED_PIPELINE
        or not group.transformers
    ):
        fail()

    source_geometry = json.load(sys.stdin)
    if source_geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        fail()
    transformed = {
        "type": source_geometry["type"],
        "coordinates": transform_coordinates(source_geometry.get("coordinates"), transformer),
    }
    result = {
        "geometry": transformed,
        "toolchain": {
            "pyprojVersion": pyproj.__version__,
            "projVersion": pyproj.proj_version_str,
            "projDatabaseSha256": database_hash,
            "platformKey": key,
            "operationAuthority": "EPSG",
            "operationCode": 8368,
            "operationName": "S-JTSK [JTSK03] to WGS 84 (1)",
            "accuracyMetres": 1.0,
            "pipeline": pipeline,
            "axisOrder": "easting,northing -> longitude,latitude",
            "alwaysXY": True,
            "networkGridAccess": "disabled",
            "gridFiles": [],
            "outputDecimalPlaces": 10,
        },
    }
    sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never print input coordinates or the PROJ configuration to build logs.
        sys.stderr.write("Pinned offline boundary transformation failed.\n")
        raise SystemExit(1)
