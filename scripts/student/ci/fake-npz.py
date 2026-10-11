"""A small KataGo-format training file (made-up positions) for testing kata_npz.py: fake-npz.py out.npz"""
import numpy as np, sys
rng=np.random.default_rng(0)
N=50
bits=np.zeros((N,22,368),np.uint8)
bits[:,0,:361]=1
st=rng.integers(0,3,(N,361))
bits[:,1,:361]=st==1; bits[:,2,:361]=st==2
lib=rng.integers(0,4,(N,361))*(st>0)
for k in (1,2,3): bits[:,2+k,:361]=lib==k
bits[:,6,5]=1
bits[:,9,10]=1; bits[:,10,11]=1; bits[:,11,12]=1
bits[1,0,360]=0  # off board row -> dropped
packed=np.packbits(bits,axis=2)
gin=np.zeros((N,19),np.float32); gin[:,5]=7.5/15
gt=np.zeros((N,80),np.float32); gt[:,26]=1; gt[:,27]=1; gt[:,29]=1; gt[:,16]=0.7; gt[:,17]=0.3; gt[:,21]=3.5; gt[:,47]=-7.5; gt[:,60]=600
gt[2,26]=0 # no policy -> dropped
pol=np.zeros((N,2,362),np.int16); pol[:,0,72]=300; pol[:,0,60]=100; pol[:,0,361]=5
vt=np.zeros((N,5,19,19),np.int8); vt[:,0]=1
np.savez_compressed(sys.argv[1],binaryInputNCHWPacked=packed,globalInputNC=gin,policyTargetsNCMove=pol,globalTargetsNC=gt,scoreDistrN=np.zeros((N,10),np.int8),valueTargetsNCHW=vt)
