import appStoreConnect from './appStoreConnect.js'

// Creative assets (iOS 27+): the product page header and the search results
// artwork. They live in the App Asset Library: the image is uploaded once and
// placed on each store localization of an App Store version, Custom Product
// Page or Product Page Optimization treatment. The screenshot bundle routes
// the editor's creative-header and creative-search folders here.

export const CREATIVE_PLACEMENTS = {
  PRODUCT_PAGE_HEADER_ASSET: 'Product page header',
  APP_STORE_SEARCH_RESULTS_ASSET: 'Search results',
}

// Reference data feature per target kind. A feature missing from the catalog
// falls back to every group the image's spec maps to.
const FEATURES = { version: 'APP_STORE_VERSIONS', customProductPage: 'CUSTOM_PRODUCT_PAGES', experiment: 'PRODUCT_PAGE_OPTIMIZATIONS' }

// Pixel size of a PNG or JPEG, or null.
export function imageSize(buffer) {
  if (buffer.subarray(1, 4).toString('latin1') === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) return null
      const marker = buffer[offset + 1]
      // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
      }
      offset += 2 + buffer.readUInt16BE(offset + 2)
    }
  }
  return null
}

// Image specs App Store Connect accepts for a placement type, for hints and
// for checking a file before it is uploaded.
function specsFor(refData, placementType) {
  return (refData.imageSpecs || []).filter((spec) => spec.compatiblePlacementTypes?.includes(placementType))
}

function describeSpec(spec) {
  const { minWidth, maxWidth, minHeight, maxHeight } = spec.dimensions || {}
  const size = minWidth === maxWidth && minHeight === maxHeight ? `${minWidth}×${minHeight}` : `${minWidth}×${minHeight} to ${maxWidth}×${maxHeight}`
  return `${size} (${spec.aspectRatio}, ${(spec.fileExtensions || []).join(' ')})`
}

export function checkFile(refData, placementType, { fileName, buffer }) {
  const specs = specsFor(refData, placementType)
  if (specs.length === 0) return null // catalog has nothing to check against; let App Store Connect decide

  const size = imageSize(buffer)
  const extension = `.${String(fileName).split('.').pop().toLowerCase()}`
  const fits = specs.some((spec) => {
    const { minWidth, maxWidth, minHeight, maxHeight } = spec.dimensions || {}
    const sizeOk = !size || (size.width >= minWidth && size.width <= maxWidth && size.height >= minHeight && size.height <= maxHeight)
    return sizeOk && (!spec.fileExtensions || spec.fileExtensions.includes(extension))
  })
  if (!fits) {
    const got = size ? `${size.width}×${size.height}` : 'an unreadable size'
    throw new Error(`${fileName} is ${got} ${extension}; ${CREATIVE_PLACEMENTS[placementType]} takes ${specs.map(describeSpec).join(' or ')}.`)
  }
  return size
}

// Placement groups the processed image can go in, with the max per group.
function groupsFor(refData, placementType, specId, targetKind) {
  const mapped = (refData.placementTypes || [])
    .find((item) => item.placementTypeId === placementType)
    ?.specMappings?.filter((mapping) => mapping.specs?.includes(specId))
    .map((mapping) => mapping.placementGroupId) || []

  const policy = (refData.features || [])
    .find((feature) => feature.featureId === FEATURES[targetKind])
    ?.placementPolicies?.find((item) => item.placementType === placementType)
  const limits = new Map()
  for (const limit of policy?.groupLimits || []) {
    for (const groupId of limit.groupIds || []) limits.set(groupId, limit.maxCount)
  }

  const allowed = limits.size ? mapped.filter((groupId) => limits.has(groupId)) : mapped
  return (allowed.length ? allowed : mapped).map((groupId) => ({ groupId, maxCount: limits.get(groupId) ?? 1 }))
}

// Placements of the creative types on one localization: { placementType: count }.
export async function countCreativePlacements(owner, localizationId) {
  const placements = await appStoreConnect.getLocalizationPlacements(owner, localizationId, Object.keys(CREATIVE_PLACEMENTS))
  const counts = {}
  for (const placement of placements) {
    const type = placement.attributes?.placementType
    counts[type] = (counts[type] || 0) + 1
  }
  return counts
}

// Checks the file against the catalog, uploads it to the app's library and
// resolves the placement groups App Store Connect will take it in.
export async function uploadCreativeImage(target, placementType, { fileName, buffer }) {
  const refData = await appStoreConnect.getAssetLibraryRefData()
  checkFile(refData, placementType, { fileName, buffer })

  // Reference names are unique per library and every export reuses the same
  // file names (01-…png), so the upload time keeps each one distinct.
  const uploadedAt = new Date().toISOString().replace('T', ' ').slice(0, 23)
  const library = await appStoreConnect.getAppAssetLibrary(target.appId)
  const image = await appStoreConnect.uploadAssetLibraryImage(library.id, {
    fileName,
    buffer,
    category: 'CREATIVE_ASSETS',
    referenceName: `${CREATIVE_PLACEMENTS[placementType]} · ${fileName} · ${uploadedAt}`.slice(0, 255),
  })

  const groups = groupsFor(refData, placementType, image.attributes?.specId, target.kind)
  if (groups.length === 0) {
    await appStoreConnect.deleteAssetLibraryImage(image.id).catch(() => {})
    const { width, height } = image.attributes?.imageAsset || {}
    throw new Error(`App Store Connect matched ${fileName}${width ? ` (${width}×${height})` : ''} to a spec that ${CREATIVE_PLACEMENTS[placementType]} does not take.`)
  }

  return { imageId: image.id, groups }
}

// Places an uploaded image on one localization. With `replace` the placement
// already in a group is removed first (its image stays in the library).
export async function placeCreativeImage({ owner, localizationId, imageId, placementType, groups, replace = false }) {
  const existing = await appStoreConnect.getLocalizationPlacements(owner, localizationId, [placementType])
  const placed = []
  const errors = []

  for (const { groupId, maxCount } of groups) {
    const inGroup = existing.filter((placement) => placement.attributes?.placementGroup === groupId)
    if (inGroup.length >= maxCount && !replace) {
      errors.push(`${groupId} already has ${inGroup.length}`)
      continue
    }
    try {
      if (replace) {
        for (const placement of inGroup) await appStoreConnect.deleteAssetLibraryPlacement(placement.id)
      }
      placed.push((await appStoreConnect.createAssetLibraryPlacement({ owner, localizationId, imageId, placementType, placementGroup: groupId })).id)
    } catch (error) {
      errors.push(`${groupId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (placed.length === 0) throw new Error(errors.join('; ') || 'no placement group accepted the image')
  return { placed, deleted: replace ? existing.filter((placement) => groups.some((group) => group.groupId === placement.attributes?.placementGroup)).length : 0 }
}
