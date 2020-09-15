import protons from 'protons'
import protoDef from './dag.proto.js'

const proto = protons(protoDef)

const code = 0x70
const name = 'dag-pb'
const pbNodeProperties = ['Data', 'Links']
const pbLinkProperties = ['Hash', 'Name', 'Tsize']

const textEncoder = new TextEncoder()

function linkComparator (a, b) {
  if (a === b) {
    return 0
  }

  const abuf = textEncoder.encode(a.Name)
  const bbuf = textEncoder.encode(b.Name)

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

function hasOnlyProperties (node, properties) {
  return !Object.keys(node).some((p) => !properties.includes(p))
}

function create (multiformats) {
  const { CID, bytes } = multiformats

  const asLink = (link) => {
    if (typeof link.asCID === 'object') {
      return { Hash: CID.asCID(link), Name: '', Tsize: 0 }
    }

    let cid
    try {
      cid = CID.from(link.Hash)
    } catch (e) {}

    if (!cid) {
      throw new TypeError('Invalid DAG-PB form (bad Hash/CID)')
    }

    return {
      Hash: cid,
      Name: link.Name || '',
      Tsize: link.Tsize || 0
    }
  }

  const prepare = (node) => {
    if (node instanceof Uint8Array || typeof node === 'string') {
      node = { Data: node }
    }

    if (typeof node !== 'object' || Array.isArray(node)) {
      throw new TypeError('Invalid DAG-PB form')
    }

    const pbn = {}

    if (node.Data) {
      if (typeof node.Data === 'string') {
        pbn.Data = textEncoder.encode(node.Data)
      } else if (node.Data instanceof Uint8Array & node.Data.length > 0) {
        // zero-length data must be null, can't be Uint8Array(0)
        pbn.Data = node.Data
      }
    }

    if (node.Links && node.Links.length > 0) {
      pbn.Links = node.Links.map(asLink)
      pbn.Links.sort(linkComparator)
    } else {
      pbn.Links = []
    }

    return pbn
  }

  const validate = (node) => {
    /*
    type PBLink struct {
      Hash optional Link
      Name String (implicit "")
      Tsize Int (implicit "0")
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

    if (!Array.isArray(node.Links)) {
      throw new TypeError('Invalid DAG-PB form (Links must be an array)')
    }

    if (node.Data && !(node.Data instanceof Uint8Array)) {
      throw new TypeError('Invalid DAG-PB form (Data must be a Uint8Array)')
    }

    for (let i = 0; i < node.Links.length; i++) {
      const link = node.Links[i]
      if (!link || typeof link !== 'object' || Array.isArray(link)) {
        throw new TypeError('Invalid DAG-PB form (bad link object)')
      }

      if (!hasOnlyProperties(link, pbLinkProperties)) {
        throw new TypeError('Invalid DAG-PB form (extraneous properties on link object)')
      }

      if (link.Hash && link.Hash.asCID !== link.Hash) {
        throw new TypeError('Invalid DAG-PB form (link Hash must be a CID)')
      }

      if (typeof link.Name !== 'string') {
        throw new TypeError('Invalid DAG-PB form (link Name must be a string)')
      }

      if (typeof link.Tsize !== 'number' || link.Tsize % 1 !== 0) {
        throw new TypeError('Invalid DAG-PB form (link Tsize must be an integer)')
      }

      if (i > 0 && linkComparator(link, node.Links[i - 1]) === -1) {
        throw new TypeError('Invalid DAG-PB form (links must be sort by Name bytes)')
      }
    }
  }

  const encode = (node) => {
    validate(node)
    const pbn = {
      Links: node.Links.map((l) => {
        return {
          Hash: l.Hash.bytes, // cid -> bytes
          Name: l.Name,
          Tsize: l.Tsize
        }
      })
    }
    if (node.Data) {
      pbn.Data = node.Data
    }
    const serialized = proto.PBNode.encode(pbn)
    return bytes.coerce(serialized)
  }

  const decode = (bytes) => {
    const pbn = proto.PBNode.decode(bytes)

    const node = {
      Links: pbn.Links.map((link) => {
        return {
          Name: link.Name,
          Tsize: link.Tsize,
          Hash: new CID(link.Hash)
        }
      }),
      Data: pbn.Data == null ? new Uint8Array(0) : pbn.Data
    }

    return node
  }

  return { encode, decode, validate, prepare, code, name }
}

export default create
