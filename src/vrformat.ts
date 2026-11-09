/**
 * How a video is meant to be seen, guessed from its file name, so the headset
 * opens it in the right mode: flat, 180° or 360°, fisheye lenses, side by side
 * or top and bottom.
 *
 * The flags are DeoVR's naming convention (deovr.com/app/doc, section 10
 * "Naming convention for supported meshes": _180, _360, _fisheye,
 * _fisheye190, _mkx200, _vrca220, _LR / _3DH / _SBS, _TB / _3DV /
 * _OverUnder; not case-sensitive, any order), which HereSphere reads too,
 * plus a few common in release names (180x180, _OU, _mkx220, _rf52, _mono).
 * The values sent are those XBVR sends each player for the same formats
 * (github.com/xbapps/xbvr, pkg/api/heresphere.go lines 632-696 and
 * pkg/api/deovr.go lines 358-500).
 *
 * A name with no flag at all is taken as a flat video: a library of a
 * funscript player is mostly flat, and a VR video almost always says so.
 */

export interface VrFormat {
  /** 'flat' for a normal video. */
  projection: 'flat' | '180' | '360' | 'fisheye'
  stereo: 'mono' | 'sbs' | 'tb'
  /** Degrees. */
  fov: number
  /** HereSphere's lens profile: Linear, or a camera's (MKX200…). */
  lens: 'Linear' | 'MKX200' | 'MKX220' | 'VRCA220'
}

const FLAT: VrFormat = { projection: 'flat', stereo: 'mono', fov: 180, lens: 'Linear' }

export function guessFormat(fileName: string): VrFormat {
  const base = fileName.replace(/\.[^.]+$/, '')
  const words = new Set(base.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  const has = (...w: string[]) => w.some(x => words.has(x))

  let projection: VrFormat['projection'] | null = null
  let fov = 180
  let lens: VrFormat['lens'] = 'Linear'
  if (has('mkx200')) {
    projection = 'fisheye'
    fov = 200
    lens = 'MKX200'
  }
  else if (has('mkx220')) {
    projection = 'fisheye'
    fov = 220
    lens = 'MKX220'
  }
  else if (has('vrca220')) {
    projection = 'fisheye'
    fov = 220
    lens = 'VRCA220'
  }
  else if (has('fisheye190', 'rf52')) {
    projection = 'fisheye'
    fov = 190
  }
  else if (has('fisheye')) {
    projection = 'fisheye'
  }
  else if (has('360', '360x180')) {
    projection = '360'
    fov = 360
  }
  else if (has('180', '180x180', 'vr180')) {
    projection = '180'
  }

  let stereo: VrFormat['stereo'] | null = null
  if (has('lr', 'sbs', '3dh', 'rl'))
    stereo = 'sbs'
  else if (has('tb', 'ou', '3dv', 'overunder', 'bt'))
    stereo = 'tb'
  else if (has('mono', '2d'))
    stereo = 'mono'

  if (!projection && !stereo)
    return { ...FLAT }
  // A stereo flag alone: VR, and 180° is what nearly all of it is.
  if (!projection)
    projection = '180'
  // A projection alone: 180° and fisheye are almost always side by side; 360° mono.
  if (!stereo)
    stereo = projection === '360' ? 'mono' : 'sbs'
  return { projection, stereo, fov, lens }
}

/** HereSphere's `projection`, `stereo`, `fov` and `lens` fields. */
export function hereSphereFormat(f: VrFormat) {
  const projection = f.projection === 'flat' ? 'perspective' : f.projection === '360' ? 'equirectangular360' : f.projection === 'fisheye' ? 'fisheye' : 'equirectangular'
  return { projection, stereo: f.stereo, fov: f.fov, lens: f.lens }
}

/** DeoVR's `screenType` and `stereoMode`. */
export function deoVrFormat(f: VrFormat) {
  let screenType: string
  if (f.projection === 'flat')
    screenType = 'flat'
  else if (f.projection === '360')
    screenType = 'sphere'
  else if (f.projection === '180')
    screenType = 'dome'
  else if (f.lens === 'MKX200')
    screenType = 'mkx200'
  else if (f.lens === 'MKX220')
    screenType = 'mkx220'
  else if (f.lens === 'VRCA220')
    screenType = 'vrca220'
  else if (f.fov === 190)
    screenType = 'rf52'
  else
    screenType = 'fisheye'
  return { screenType, stereoMode: f.stereo === 'mono' ? 'off' : f.stereo }
}
