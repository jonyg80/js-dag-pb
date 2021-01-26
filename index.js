import CID from 'multiformats/cid'
import decodeNode from './pb-decode.js'
import encodeNode from './pb-encode.js'

const code = 0x70
const name = 'dag-pb'
const pbNodeProperties = ['Data', 'Links']
const pbLinkProperties = ['Hash', 'Name', 'Tsize']

const textEncoder = new TextEncoder()

/**
 * @typedef {{ Name?: string, Tsize: number, Hash: CID }} DAGLink
 * @typedef {{ Data: Uint8Array, Links: Array<DAGLink> }} DAGNode
 *
 * @typedef {{ Name?: string, Tsize?: number, Hash?: Uint8Array }} PBLink
 * @typedef {{ Data?: Uint8Array, Links: Array<PBLink> }} PBNode
 */

/**
 * @param {DAGLink} a
 * @param {DAGLink} b
 */
function linkComparator (a, b) {
  if (a === b) {
    return 0
  }

  const abuf = a.Name ? textEncoder.encode(a.Name) : []
  const bbuf = b.Name ? textEncoder.encode(b.Name) : []

  let x = abuf.length
  let y = bbuf.length

  for (let i = 0, len = Math.min(x, y); i < len; ++i) {
    if (abuf[i] !== bbuf[i]) {
      x = abuf[i]
      y = bbuf[i]
      break
    }
  }

  return x < y ? -1 : y < x ? 1 : 0
}

/**
 *
 * @param {object} node
 * @param {Array<string>} properties
 */
function hasOnlyProperties (node, properties) {
  return !Object.keys(node).some((p) => !properties.includes(p))
}

/**
 * @param {{ Name?: string, Tsize: number, Hash: CID | Uint8Array | string }} link
 */
function asLink (link) {
  const pbl = {}

  if (link.Hash) {
    let cid = CID.asCID(link.Hash)
    try {
      if (!cid) {
        if (typeof link.Hash === 'string') {
          cid = CID.parse(link.Hash)
        } else if (link.Hash instanceof Uint8Array) {
          cid = CID.decode(link.Hash)
        }
      }
    } catch (e) {
      throw new TypeError(`Invalid DAG-PB form: ${e.message}`)
    }

    if (cid) {
      pbl.Hash = cid
    }
  }

  if (!pbl.Hash) {
    throw new TypeError('Invalid DAG-PB form')
  }

  if (typeof link.Name === 'string') {
    pbl.Name = link.Name
  }

  if (typeof link.Tsize === 'number') {
    pbl.Tsize = link.Tsize
  }

  return pbl
}

/**
 * @param {Uint8Array|string|DAGNode} node
 */
function prepare (node) {
  if (node instanceof Uint8Array) {
    node = { Data: node, Links: [] }
  }

  if (typeof node === 'string') {
    node = { Data: textEncoder.encode(node), Links: [] }
  }

  if (typeof node !== 'object' || Array.isArray(node)) {
    throw new TypeError('Invalid DAG-PB form')
  }

  /** @type DAGNode */
  const pbn = {}

  if (node.Data) {
    if (typeof node.Data === 'string') {
      pbn.Data = textEncoder.encode(node.Data)
    } else if (node.Data instanceof Uint8Array) {
      pbn.Data = node.Data
    }
  }

  if (node.Links && Array.isArray(node.Links) && node.Links.length) {
    pbn.Links = node.Links.map(asLink)
    pbn.Links.sort(linkComparator)
  } else {
    pbn.Links = []
  }

  return pbn
}

/**
 * @param {*} node
 */
function validate (node) {
  /*
  type PBLink struct {
    Hash optional Link
    Name optional String
    Tsize optional Int
  }

  type PBNode struct {
    Links [PBLink]
    Data optional Bytes
  }
  */
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new TypeError('Invalid DAG-PB form')
  }

  if (!hasOnlyProperties(node, pbNodeProperties)) {
    throw new TypeError('Invalid DAG-PB form (extraneous properties)')
  }

  if (node.Data !== undefined && !(node.Data instanceof Uint8Array)) {
    throw new TypeError('Invalid DAG-PB form (Data must be a Uint8Array)')
  }

  if (!Array.isArray(node.Links)) {
    throw new TypeError('Invalid DAG-PB form (Links must be an array)')
  }

  for (let i = 0; i < node.Links.length; i++) {
    const link = node.Links[i]
    if (!link || typeof link !== 'object' || Array.isArray(link)) {
      throw new TypeError('Invalid DAG-PB form (bad link object)')
    }

    if (!hasOnlyProperties(link, pbLinkProperties)) {
      throw new TypeError('Invalid DAG-PB form (extraneous properties on link object)')
    }

    if (!link.Hash) {
      throw new TypeError('Invalid DAG-PB form (link must have a Hash)')
    }

    if (link.Hash.asCID !== link.Hash) {
      throw new TypeError('Invalid DAG-PB form (link Hash must be a CID)')
    }

    if (link.Name !== undefined && typeof link.Name !== 'string') {
      throw new TypeError('Invalid DAG-PB form (link Name must be a string)')
    }

    if (link.Tsize !== undefined && (typeof link.Tsize !== 'number' || link.Tsize % 1 !== 0)) {
      throw new TypeError('Invalid DAG-PB form (link Tsize must be an integer)')
    }

    if (i > 0 && linkComparator(link, node.Links[i - 1]) === -1) {
      throw new TypeError('Invalid DAG-PB form (links must be sorted by Name bytes)')
    }
  }
}

/**
 * @param {DAGNode} node
 */
function encode (node) {
  validate(node)

  const pbn = {}
  if (node.Links) {
    pbn.Links = node.Links.map((l) => {
      const link = {}
      if (l.Hash) {
        link.Hash = l.Hash.bytes // cid -> bytes
      }
      if (l.Name !== undefined) {
        link.Name = l.Name
      }
      if (l.Tsize !== undefined) {
        link.Tsize = l.Tsize
      }
      return link
    })
  }
  if (node.Data) {
    pbn.Data = node.Data
  }

  return encodeNode(pbn)
}

/**
 * @param {Uint8Array} bytes
 */
function decode (bytes) {
  const pbn = decodeNode(bytes)

  const node = {}

  if (pbn.Data) {
    node.Data = pbn.Data
  }

  if (pbn.Links) {
    node.Links = pbn.Links.map((l) => {
      const link = {}
      try {
        link.Hash = CID.decode(l.Hash)
      } catch (e) {}
      if (!link.Hash) {
        throw new Error('Invalid Hash field found in link, expected CID')
      }
      if (l.Name !== undefined) {
        link.Name = l.Name
      }
      if (l.Tsize !== undefined) {
        link.Tsize = l.Tsize
      }
      return link
    })
  }

  return node
}

export { name, code, encode, decode, prepare, validate }
