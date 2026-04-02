use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address
use cardano/assets
use cardano/transaction.{NoDatum, Output, OutputReference, Transaction, placeholder}

/// On-chain listing: buyer spends this UTxO only if the same transaction pays
/// at least `price` lovelace to `seller_vkh` (payment credential match).
/// `dataset_id` is carried for off-chain indexing / future constraints (v1: not enforced on-chain beyond presence).
pub type LicenseListingDatum {
  seller_vkh: VerificationKeyHash,
  dataset_id: ByteArray,
  price: Int,
}

pub type LicenseRedeemer {
  Purchase
}

/// Sum lovelace sent to outputs whose **payment** credential is the given vkey hash.
pub fn lovelace_paid_to_vkh(outputs: List<Output>, vkh: VerificationKeyHash) -> Int {
  when outputs is {
    [] -> 0
    [o, ..rest] -> {
      let paid_here = when o.address.payment_credential is {
        address.VerificationKey(pk) ->
          if pk == vkh {
            assets.lovelace_of(o.value)
          } else {
            0
          }
        address.Script(_) -> 0
      }
      paid_here + lovelace_paid_to_vkh(rest, vkh)
    }
  }
}

pub fn license_purchase_valid(datum: LicenseListingDatum, transaction: Transaction) -> Bool {
  and {
    datum.price > 0,
    lovelace_paid_to_vkh(transaction.outputs, datum.seller_vkh) >= datum.price,
  }
}

validator nuauth_license_listing {
  spend(
    datum: Option<LicenseListingDatum>,
    redeemer: LicenseRedeemer,
    _own_ref: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(d) = datum
    expect Purchase = redeemer
    license_purchase_valid(d, transaction)
  }

  else(_) {
    fail
  }
}

// --- Tests (no Lucid; pure ledger logic) ---

const test_vkh: VerificationKeyHash =
  #"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c"

const test_dataset: ByteArray = "ds-test-01"

test lovelace_paid_to_vkh_sums_matching_outputs() {
  let addr = address.from_verification_key(test_vkh)
  let out1 =
    Output {
      address: addr,
      value: assets.from_lovelace(5_000_000),
      datum: NoDatum,
      reference_script: None,
    }
  let out2 =
    Output {
      address: addr,
      value: assets.from_lovelace(3_000_000),
      datum: NoDatum,
      reference_script: None,
    }
  lovelace_paid_to_vkh([out1, out2], test_vkh) == 8_000_000
}

test license_purchase_valid_when_price_met() {
  let datum =
    LicenseListingDatum {
      seller_vkh: test_vkh,
      dataset_id: test_dataset,
      price: 7_000_000,
    }
  let seller_addr = address.from_verification_key(test_vkh)
  let pay_seller =
    Output {
      address: seller_addr,
      value: assets.from_lovelace(7_000_000),
      datum: NoDatum,
      reference_script: None,
    }
  let tx = Transaction { ..placeholder, outputs: [pay_seller] }
  license_purchase_valid(datum, tx)
}

test license_purchase_valid_when_overpaid() {
  let datum =
    LicenseListingDatum {
      seller_vkh: test_vkh,
      dataset_id: test_dataset,
      price: 2_000_000,
    }
  let pay_seller =
    Output {
      address: address.from_verification_key(test_vkh),
      value: assets.from_lovelace(5_000_000),
      datum: NoDatum,
      reference_script: None,
    }
  let tx = Transaction { ..placeholder, outputs: [pay_seller] }
  license_purchase_valid(datum, tx)
}

test license_purchase_invalid_when_underpaid() fail {
  let datum =
    LicenseListingDatum {
      seller_vkh: test_vkh,
      dataset_id: test_dataset,
      price: 10_000_000,
    }
  let pay_seller =
    Output {
      address: address.from_verification_key(test_vkh),
      value: assets.from_lovelace(9_999_999),
      datum: NoDatum,
      reference_script: None,
    }
  let tx = Transaction { ..placeholder, outputs: [pay_seller] }
  license_purchase_valid(datum, tx)
}

test license_purchase_invalid_zero_price() fail {
  let datum =
    LicenseListingDatum {
      seller_vkh: test_vkh,
      dataset_id: test_dataset,
      price: 0,
    }
  let pay_seller =
    Output {
      address: address.from_verification_key(test_vkh),
      value: assets.from_lovelace(1),
      datum: NoDatum,
      reference_script: None,
    }
  let tx = Transaction { ..placeholder, outputs: [pay_seller] }
  license_purchase_valid(datum, tx)
}
