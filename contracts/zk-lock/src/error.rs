use ckb_std::error::SysError;

#[cfg_attr(test, derive(Debug, PartialEq))]
#[repr(i8)]
pub enum Error {
    IndexOutOfBound = 1,
    ItemMissing,
    LengthNotEnough,
    Encoding,
    Unknown,
    ArgsLength = 10,
    WitnessLockMissing,
    WitnessLockTooShort,
    PublicInputsLengthMismatch,
    VKeyNotFound,
    PiCommitmentMismatch,
    InvalidVk,
    InvalidProof,
    InvalidPublicInputs,
    PublicInputCountMismatch,
    VerificationFailed,
    VKeyDuplicated,
}

impl From<SysError> for Error {
    fn from(err: SysError) -> Self {
        use SysError::*;
        match err {
            IndexOutOfBound => Self::IndexOutOfBound,
            ItemMissing => Self::ItemMissing,
            LengthNotEnough(_) => Self::LengthNotEnough,
            Encoding => Self::Encoding,
            _ => Self::Unknown,
        }
    }
}

impl From<verifier_core::VerifyError> for Error {
    fn from(err: verifier_core::VerifyError) -> Self {
        use verifier_core::VerifyError::*;
        match err {
            InvalidVk => Self::InvalidVk,
            InvalidProof => Self::InvalidProof,
            InvalidPublicInputs => Self::InvalidPublicInputs,
            PublicInputCountMismatch => Self::PublicInputCountMismatch,
            VerificationFailed => Self::VerificationFailed,
        }
    }
}
