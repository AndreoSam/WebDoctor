// Deployment consolidation marker.
// WebDoctor's hosted API routes are deployed together from this commit.
export default function handler(req,res){res.status(200).json({ok:true,service:'WebDoctor',hostedApi:true});}
