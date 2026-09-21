import assert from "node:assert/strict";
import test from "node:test";
import {
  clampLocalProfileAvatarCropOffset,
  LOCAL_PROFILE_AVATAR_STAGE_SIZE_PX,
  MAX_LOCAL_PROFILE_AVATAR_ZOOM,
  normalizeLocalProfileAvatarZoom,
  resolveLocalProfileAvatarCropGeometry,
} from "../src/lib/localProfileAvatar.js";

/**
 * 头像裁剪的换算逻辑决定了「预览看到的圆形范围」和「最终存下的圆形范围」是否一致。
 * 这里只覆盖纯计算部分：DOM 解码/编码无法在 node 里跑，但坐标换算可以。
 */

test("宽图在 zoom=1 时按短边铺满取景框，并裁出居中的最大正方形", () => {
  const geometry = resolveLocalProfileAvatarCropGeometry(
    { width: 400, height: 200 },
    { zoom: 1, offsetX: 0, offsetY: 0 },
  );

  assert.equal(geometry.scale, 1.2);
  assert.equal(geometry.displayWidth, 480);
  assert.equal(geometry.displayHeight, 240);
  assert.equal(geometry.sourceSize, 200);
  assert.equal(geometry.sourceX, 100);
  assert.equal(geometry.sourceY, 0);
});

test("高图在 zoom=1 时同样按短边铺满，不出现留白", () => {
  const geometry = resolveLocalProfileAvatarCropGeometry(
    { width: 200, height: 400 },
    { zoom: 1, offsetX: 0, offsetY: 0 },
  );

  assert.equal(geometry.scale, 1.2);
  assert.equal(geometry.displayWidth, 240);
  assert.equal(geometry.displayHeight, 480);
  assert.equal(geometry.sourceSize, 200);
  assert.equal(geometry.sourceX, 0);
  assert.equal(geometry.sourceY, 100);
});

test("正方形原图在 zoom=1 时整张即取景结果", () => {
  const geometry = resolveLocalProfileAvatarCropGeometry(
    { width: 300, height: 300 },
    { zoom: 1, offsetX: 0, offsetY: 0 },
  );

  assert.equal(geometry.sourceSize, 300);
  assert.equal(geometry.sourceX, 0);
  assert.equal(geometry.sourceY, 0);
});

test("位移超出边界时收敛到图片边缘，不会裁到原图之外", () => {
  const source = { width: 400, height: 200 };

  const left = resolveLocalProfileAvatarCropGeometry(source, {
    zoom: 1,
    offsetX: 99_999,
    offsetY: 0,
  });
  assert.equal(left.offsetX, 120);
  assert.equal(left.sourceX, 0);

  const right = resolveLocalProfileAvatarCropGeometry(source, {
    zoom: 1,
    offsetX: -99_999,
    offsetY: 0,
  });
  assert.equal(right.offsetX, -120);
  assert.equal(right.sourceX, source.width - right.sourceSize);

  const vertical = resolveLocalProfileAvatarCropGeometry(source, {
    zoom: 2,
    offsetX: 0,
    offsetY: -99_999,
  });
  // 向下拖到极限：位移收敛到负的最大值，取景框贴住原图下边缘。
  assert.equal(vertical.offsetY, -120);
  assert.equal(vertical.sourceY + vertical.sourceSize, source.height);
});

test("缩放收敛到 [1, 4]，非法值回退到最小值", () => {
  assert.equal(normalizeLocalProfileAvatarZoom(0.2), 1);
  assert.equal(normalizeLocalProfileAvatarZoom(1), 1);
  assert.equal(normalizeLocalProfileAvatarZoom(2.5), 2.5);
  assert.equal(normalizeLocalProfileAvatarZoom(9), MAX_LOCAL_PROFILE_AVATAR_ZOOM);
  assert.equal(normalizeLocalProfileAvatarZoom(Number.NaN), 1);
  assert.equal(normalizeLocalProfileAvatarZoom("2"), 1);
});

test("小图放大后 zoom=1 时没有可拖动空间，放大后才出现", () => {
  const source = { width: 40, height: 40 };

  assert.deepEqual(
    clampLocalProfileAvatarCropOffset({ ...source, zoom: 1, offsetX: 500, offsetY: -500 }),
    {
      offsetX: 0,
      offsetY: 0,
    },
  );

  const zoomed = clampLocalProfileAvatarCropOffset({
    ...source,
    zoom: 2,
    offsetX: 500,
    offsetY: -500,
  });
  assert.equal(zoomed.offsetX, 120);
  assert.equal(zoomed.offsetY, -120);
});

test("任意缩放与位移组合下，裁剪区域始终完整落在原图内", () => {
  const sources = [
    { width: 400, height: 200 },
    { width: 200, height: 400 },
    { width: 300, height: 300 },
    { width: 40, height: 40 },
    { width: 4000, height: 3000 },
  ];

  for (const source of sources) {
    for (const zoom of [1, 1.37, 2, 3.5, 4]) {
      for (const offsetX of [-5000, -37, 0, 37, 5000]) {
        for (const offsetY of [-5000, -37, 0, 37, 5000]) {
          const geometry = resolveLocalProfileAvatarCropGeometry(source, {
            zoom,
            offsetX,
            offsetY,
          });
          const label = `${source.width}x${source.height} zoom=${zoom} offset=${offsetX},${offsetY}`;

          assert.ok(geometry.sourceSize > 0, label);
          assert.ok(geometry.sourceX >= 0, label);
          assert.ok(geometry.sourceY >= 0, label);
          assert.ok(geometry.sourceX + geometry.sourceSize <= source.width + 1e-9, label);
          assert.ok(geometry.sourceY + geometry.sourceSize <= source.height + 1e-9, label);

          // 铺满不变式：缩小到最小时预览也必须盖住整个取景框，否则圆内会露出底色。
          assert.ok(geometry.displayWidth >= LOCAL_PROFILE_AVATAR_STAGE_SIZE_PX - 1e-9, label);
          assert.ok(geometry.displayHeight >= LOCAL_PROFILE_AVATAR_STAGE_SIZE_PX - 1e-9, label);
        }
      }
    }
  }
});

test("取景框中心映射回原图后落在裁剪区域正中心", () => {
  const source = { width: 800, height: 600 };
  const geometry = resolveLocalProfileAvatarCropGeometry(source, {
    zoom: 1.8,
    offsetX: -60,
    offsetY: 25,
  });

  const centerX = geometry.sourceX + geometry.sourceSize / 2;
  const centerY = geometry.sourceY + geometry.sourceSize / 2;

  assert.ok(Math.abs(centerX - (source.width / 2 - geometry.offsetX / geometry.scale)) < 1e-9);
  assert.ok(Math.abs(centerY - (source.height / 2 - geometry.offsetY / geometry.scale)) < 1e-9);
});

test("原图尺寸非法时直接拒绝，避免出现除零的裁剪区域", () => {
  for (const source of [
    { width: 0, height: 100 },
    { width: 100, height: 0 },
  ]) {
    assert.throws(
      () => resolveLocalProfileAvatarCropGeometry(source, { zoom: 1, offsetX: 0, offsetY: 0 }),
      /decode-failed/,
    );
  }
});
