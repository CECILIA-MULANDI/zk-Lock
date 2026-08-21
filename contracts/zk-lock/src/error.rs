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
