/*!
 * claim.js - DNSSEC ownership proofs for hskd
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/handshake-org/hskd
 */

'use strict';

const assert = require('assert');
const bio = require('bufio');
const blake2b = require('bcrypto/lib/blake2b');
const consensus = require('../protocol/consensus');
const policy = require('../protocol/policy');
const rules = require('../covenants/rules');
const ownership = require('../covenants/ownership');
const InvItem = require('./invitem');
const TX = require('./tx');
const Input = require('./input');
const Output = require('./output');
const {types} = rules;
const {OwnershipProof} = ownership;

/*
 * Constants
 */

const EMPTY = Buffer.alloc(0);

/**
 * Claim
 * @extends {bufio.Struct}
 */

class Claim extends bio.Struct {
  constructor() {
    super();

    this.blob = EMPTY;

    this._hash = null;
    this._hhash = null;
    this._data = null;
  }

  refresh() {
    this._hash = null;
    this._hhash = null;
    this._data = null;
    return this;
  }

  hash(enc) {
    let h = this._hash;

    if (!h)
      h = blake2b.digest(this.blob);

    if (enc === 'hex') {
      let hex = this._hhash;

      if (!hex) {
        hex = h.toString('hex');
        this._hhash = hex;
      }

      h = hex;
    }

    return h;
  }

  getData(network) {
    if (!this._data) {
      const proof = this.getProof();

      if (!proof)
        return null;

      const data = proof.getData(network);

      if (!data)
        return null;

      this._data = data;
    }

    return this._data;
  }

  getNameHash(network) {
    const data = this.getData(network);

    if (!data)
      return null;

    return data.nameHash;
  }

  getSize() {
    return bio.sizeVarBytes(this.blob);
  }

  write(bw) {
    bw.writeVarBytes(this.blob);
    return bw;
  }

  read(br) {
    const size = br.readVarint();

    if (size > 10000)
      throw new Error('Invalid claim size.');

    this.blob = br.readBytes(size);

    return this;
  }

  toInv() {
    return new InvItem(InvItem.types.CLAIM, this.hash('hex'));
  }

  getWeight() {
    return this.getSize();
  }

  getVirtualSize() {
    const scale = consensus.WITNESS_SCALE_FACTOR;
    return (this.getWeight() + scale - 1) / scale | 0;
  }

  getMinFee(size, rate) {
    if (size == null)
      size = this.getVirtualSize();

    return policy.getMinFee(size, rate);
  }

  getFee(network) {
    const data = this.getData(network);
    assert(data);
    return data.fee;
  }

  getRate(size, network) {
    const fee = this.getFee(network);

    if (size == null)
      size = this.getVirtualSize();

    return policy.getRate(size, fee);
  }

  toTX(network) {
    const data = this.getData(network);
    assert(data);

    const tx = new TX();

    tx.inputs.push(new Input());
    tx.outputs.push(new Output());

    const input = new Input();
    input.witness.items.push(this.blob);

    const output = new Output();

    if (data.forked)
      output.value = 0;
    else
      output.value = data.value - data.fee;

    output.address.version = data.version;
    output.address.hash = data.hash;

    let flags = 0;

    if (data.weak)
      flags |= 1;

    if (data.forked)
      flags |= 2;

    output.covenant.type = types.CLAIM;
    output.covenant.items.push(data.nameHash);
    output.covenant.items.push(data.nameRaw);
    output.covenant.items.push(Buffer.from([flags]));

    tx.inputs.push(input);
    tx.outputs.push(output);

    tx.refresh();

    return tx;
  }

  getProof() {
    try {
      return this.toProof();
    } catch (e) {
      return new OwnershipProof();
    }
  }

  toProof() {
    return OwnershipProof.decode(this.blob);
  }

  toBlob() {
    return this.blob;
  }

  fromBlob(blob) {
    assert(Buffer.isBuffer(blob));
    this.blob = blob;
    return this;
  }

  static fromBlob(blob) {
    return new this().fromBlob(blob);
  }

  fromProof(proof) {
    assert(proof instanceof OwnershipProof);
    this.blob = proof.encode();
    return this;
  }

  static fromProof(proof) {
    return new this().fromProof(proof);
  }
}

/*
 * Expose
 */

module.exports = Claim;